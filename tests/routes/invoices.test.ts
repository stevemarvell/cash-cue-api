import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('../../src/auth/middleware.js', async () => {
  const { authPlugin } = await import('../helpers/authMock.js');
  return { authPlugin };
});

vi.mock('../../src/services/ai.js', () => ({
  generateChaser: vi.fn().mockResolvedValue({
    invoiceId: 'inv_1', tone: 'friendly', subject: 'Hi', body: 'Pay please.', citesStatutoryInterest: false,
  }),
}));

vi.mock('../../src/services/email.js', () => ({
  sendChaser: vi.fn().mockResolvedValue(undefined),
}));

const INVOICE_ROW = {
  id: 'inv_1', ownerId: 'user_123', clientId: 'client_1', reference: 'INV-001',
  currency: 'GBP', lineItems: [{ description: 'Dev', quantity: 1, unitPriceMinor: 100000 }],
  issueDate: '2025-01-01', dueDate: '2025-06-30', paidDate: null, status: 'sent', remindersSent: 0, createdAt: new Date(),
};

const USER_ROW = {
  id: 'user_123', email: 'test@example.com', displayName: 'Test User', businessName: 'Test Biz',
  tier: 'starter', stripeCustomerId: null, stripeSubscriptionId: null,
};

/** Make a DB mock that returns invoiceRows for invoice table queries, userRows for user table queries. */
function makeDb(invoiceRows: object[] = [INVOICE_ROW], userRows: object[] = [USER_ROW]) {
  const makeChain = (rows: object[]) => {
    const c: any = { where: vi.fn(), limit: vi.fn() };
    c.where.mockReturnValue(c);
    c.limit.mockResolvedValue(rows);
    return c;
  };

  // Drizzle tables have _._config.name; but in mocks we can't inspect that
  // We track call order: user queries are separate from invoice queries.
  // Strategy: maintain a queue — caller pushes what they expect
  const invoiceChain = makeChain(invoiceRows);
  const userChain = makeChain(userRows);
  let fromCallCount = 0;

  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockImplementation(() => {
        fromCallCount++;
        // For POST /invoices: first call is users, rest are invoices
        // For GET/PATCH/DELETE: all calls are invoices
        // We expose both and let the routes work it out
        // Simple heuristic: return userChain only for the very first call
        // This works for POST (user check first). For GET, it returns INVOICE_ROW from userChain - wrong.
        // Better: always return invoiceChain, let POST tests pass userRows as invoiceRows param
        return invoiceChain;
      }),
    }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  };
}

/** DB mock for POST /invoices: user check + active invoice count + returned new invoice. */
function makePostDb(userRows: object[] = [USER_ROW], activeCountRows: object[] = [], invoiceRows: object[] = [INVOICE_ROW]) {
  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        callCount++;
        if (callCount === 1) {
          // User tier check: .where().limit(1)
          const c: any = { where: vi.fn(), limit: vi.fn() };
          c.where.mockReturnValue(c);
          c.limit.mockResolvedValue(userRows);
          return c;
        } else if (callCount === 2) {
          // Active invoice count: .where() — no .limit(), result is the where() chain
          const c: any = { where: vi.fn() };
          c.where.mockResolvedValue(activeCountRows); // awaiting .where() returns the array
          return c;
        } else {
          // Fetch new invoice: .where().limit(1)
          const c: any = { where: vi.fn(), limit: vi.fn() };
          c.where.mockReturnValue(c);
          c.limit.mockResolvedValue(invoiceRows);
          return c;
        }
      }),
    })),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({ set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }) }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  };
}

describe('/invoices routes', () => {
  it('requires auth', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).get('/invoices');
    expect(res.status).toBe(401);
  });

  it('GET /invoices/:id returns 404 for unknown', async () => {
    const app = await buildApp({ db: makeDb([]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/invoices/nope')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(404);
  });

  it('POST /invoices validates body — rejects missing fields', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/invoices')
      .set('Authorization', 'Bearer valid_token')
      .send({ ownerId: 'user_123' });
    expect(res.status).toBe(400);
  });

  it('POST /invoices rejects float unitPriceMinor', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/invoices')
      .set('Authorization', 'Bearer valid_token')
      .send({
        ownerId: 'user_123', clientId: 'client_1', reference: 'INV-002',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceMinor: 99.99 }],
        issueDate: '2025-01-01', dueDate: '2025-01-31',
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('validation_error');
  });

  it('POST /invoices returns 403 if ownerId mismatch', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/invoices')
      .set('Authorization', 'Bearer valid_token')
      .send({
        ownerId: 'user_999', clientId: 'client_1', reference: 'INV-003',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceMinor: 10000 }],
        issueDate: '2025-01-01', dueDate: '2025-01-31',
      });
    expect(res.status).toBe(403);
  });

  it('POST /invoices returns 402 when tier limit reached', async () => {
    // Starter limit is 15; fill up active count
    const active = Array(15).fill(INVOICE_ROW);
    const app = await buildApp({ db: makePostDb([USER_ROW], active) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/invoices')
      .set('Authorization', 'Bearer valid_token')
      .send({
        ownerId: 'user_123', clientId: 'client_1', reference: 'INV-NEW',
        lineItems: [{ description: 'Test', quantity: 1, unitPriceMinor: 10000 }],
        issueDate: '2025-01-01', dueDate: '2025-01-31',
      });
    expect(res.status).toBe(402);
    expect(res.body.error).toBe('invoice_limit_reached');
    expect(res.body.limit).toBe(15);
  });

  it('PATCH /invoices/:id returns 404 for unknown', async () => {
    const app = await buildApp({ db: makeDb([]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .patch('/invoices/nope')
      .set('Authorization', 'Bearer valid_token')
      .send({ reference: 'NEW' });
    expect(res.status).toBe(404);
  });

  it('DELETE /invoices/:id returns 404 for unknown', async () => {
    const app = await buildApp({ db: makeDb([]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .delete('/invoices/nope')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(404);
  });
});
