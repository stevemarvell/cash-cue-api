# PayFlow API

PayFlow is a backend REST API for a UK-focused invoicing and payment SaaS. It lets freelancers and small businesses manage invoices, chase late payments with AI-generated emails, accept card payments via Stripe, and track their cash-flow position. The service is built with Fastify, Drizzle ORM on PostgreSQL, Redis for caching, Anthropic Claude for AI copy, Stripe for subscriptions and payment links, and Resend for transactional email. Authentication is delegated to Clerk (JWT bearer tokens).

---

## Architecture

### Generate-chaser request flow

```mermaid
sequenceDiagram
    participant FE as Frontend
    participant API as Fastify API
    participant Auth as Clerk (JWT)
    participant Cache as Redis Cache
    participant DB as PostgreSQL
    participant AI as Anthropic Claude
    participant Email as Resend

    FE->>API: POST /invoices/:id/send-chaser { tone, today }
    API->>Auth: Verify Bearer token
    Auth-->>API: clerkUserId
    API->>DB: SELECT invoice WHERE id = :id AND ownerId = :userId
    DB-->>API: invoice row
    API->>DB: SELECT client WHERE id = invoice.clientId
    DB-->>API: client row
    API->>DB: SELECT user WHERE id = :userId
    DB-->>API: user row
    API->>Cache: GET chaser:{invoiceId}:{tone}:{date}
    alt cache hit
        Cache-->>API: cached ChaserMessage
    else cache miss
        API->>AI: beta.promptCaching.messages.create(systemPrompt, userPrompt)
        AI-->>API: JSON { subject, body }
        API->>Cache: SET chaser:{invoiceId}:{tone}:{date} TTL 5 min
    end
    API->>Email: resend.emails.send(to, from, subject, body)
    Email-->>API: 200 OK
    API->>DB: UPDATE invoices SET remindersSent += 1
    API->>DB: INSERT chaser_messages (tone, subject, body, citesStatutoryInterest)
    API-->>FE: 200 { invoiceId, tone, subject, body, citesStatutoryInterest }
```

### Database schema

```mermaid
erDiagram
    users {
        text id PK
        text email
        text display_name
        text business_name
        enum tier
        text stripe_customer_id
        text stripe_subscription_id
        timestamp created_at
    }

    clients {
        text id PK
        text owner_id FK
        text name
        text email
        text company
    }

    invoices {
        text id PK
        text owner_id FK
        text client_id FK
        text reference
        enum currency
        jsonb line_items
        date issue_date
        date due_date
        date paid_date
        enum status
        integer reminders_sent
        timestamp created_at
    }

    chaser_messages {
        text id PK
        text invoice_id FK
        text tone
        text subject
        text body
        text cites_statutory_interest
        timestamp sent_at
        timestamp created_at
    }

    users ||--o{ clients : "owns"
    users ||--o{ invoices : "owns"
    clients ||--o{ invoices : "billed on"
    invoices ||--o{ chaser_messages : "generates"
```

---

## API reference

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | No | Liveness probe — returns `{ status: "ok" }` |
| POST | `/auth/sync` | No | Upsert Clerk user into the database on first login |
| GET | `/users/me` | Yes | Return the authenticated user's profile and tier |
| GET | `/clients` | Yes | List all clients belonging to the authenticated user |
| POST | `/clients` | Yes | Create a new client |
| PATCH | `/clients/:id` | Yes | Update an existing client |
| DELETE | `/clients/:id` | Yes | Delete a client |
| GET | `/invoices` | Yes | List invoices for the authenticated user (lazy status refresh) |
| GET | `/invoices/:id` | Yes | Get a single invoice by ID |
| POST | `/invoices` | Yes | Create a new invoice (tier limit enforced) |
| PATCH | `/invoices/:id` | Yes | Update invoice fields |
| DELETE | `/invoices/:id` | Yes | Delete an invoice |
| POST | `/invoices/:id/send-chaser` | Yes | Generate AI chaser email and send to client |
| POST | `/ai/chaser` | Yes | Generate (but do not send) an AI chaser email, cached |
| POST | `/ai/cashflow-summary` | Yes | Generate a plain-English cash-flow summary for a set of invoices |
| POST | `/payments/subscribe` | Yes | Start a Stripe Checkout subscription session |
| POST | `/payments/cancel` | Yes | Cancel the active Stripe subscription |
| POST | `/payments/links` | Yes (business tier) | Create a Stripe Payment Link for an invoice |
| POST | `/webhooks/stripe` | No (signature verified) | Handle Stripe webhook events |

---

## Local development

### Prerequisites

- Node.js 20+
- PostgreSQL 15+
- Redis 7+ (optional — falls back to in-memory cache)

### Environment variables

Copy `.env.example` to `.env` and fill in:

```
DATABASE_URL=postgresql://user:pass@localhost:5432/payflow
REDIS_URL=redis://localhost:6379
CLERK_SECRET_KEY=sk_test_...
ANTHROPIC_API_KEY=sk-ant-...
STRIPE_SECRET_KEY=sk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_STARTER=price_...
STRIPE_PRICE_PRO=price_...
STRIPE_PRICE_BUSINESS=price_...
RESEND_API_KEY=re_...
FRONTEND_URL=http://localhost:5173
BOE_BASE_RATE=0.0475
```

### Start the dev server

```bash
npm install
npm run dev        # starts Fastify on :3000 with watch mode
```

### Run the database migrations

```bash
npm run db:push    # push schema to the connected Postgres instance
```

### Run tests

```bash
npm test           # vitest run (all 77 tests, no network calls)
npm run build      # compile TypeScript to dist/
```

---

## Business rules

### Subscription tier limits

| Tier | Max active invoices | Payment links | Price |
|------|--------------------|--------------:|-------|
| starter | 15 | No | Free |
| pro | 100 | No | Paid |
| business | Unlimited | Yes | Paid |

An "active" invoice is one with status `draft`, `sent`, or `overdue`. Creating a new invoice when the limit is reached returns HTTP 402 with `{ "error": "invoice_limit_reached", "limit": N }`.

### Statutory interest (Late Payment of Commercial Debts Act 1998)

When a chaser is generated with `firm` or `final` tone, the API calculates and includes:

- **Statutory interest**: principal × (BoE base rate + 8%) × days overdue ÷ 365, rounded to the nearest penny.
- **Fixed compensation**: £40 for debts under £1,000; £70 for debts £1,000–£9,999; £100 for debts £10,000+.

The `citesStatutoryInterest` flag in the `ChaserMessage` response indicates whether these figures were included in the generated email.

### Payment link gating

`POST /payments/links` is restricted to the `business` tier. Attempting to create a payment link on a lower tier returns HTTP 403 with `{ "error": "tier_required", "required": "business" }`.

### Stripe webhook security

The `/webhooks/stripe` endpoint verifies the `Stripe-Signature` header using the configured `STRIPE_WEBHOOK_SECRET` before processing any event. Requests with a missing or invalid signature receive HTTP 400.
