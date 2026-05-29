import { pgTable, text, integer, date, jsonb, pgEnum, timestamp } from 'drizzle-orm/pg-core';
import type { LineItem } from '../types/api.js';

export const subscriptionTierEnum = pgEnum('subscription_tier', ['starter', 'pro', 'business']);
export const invoiceStatusEnum    = pgEnum('invoice_status',    ['draft', 'sent', 'paid', 'overdue']);
export const currencyEnum         = pgEnum('currency_code',     ['GBP', 'USD', 'EUR']);

export const users = pgTable('users', {
  id:                   text('id').primaryKey(),           // Clerk user ID
  email:                text('email').notNull().unique(),
  displayName:          text('display_name').notNull(),
  businessName:         text('business_name').notNull(),
  tier:                 subscriptionTierEnum('tier').notNull().default('starter'),
  stripeCustomerId:     text('stripe_customer_id'),
  stripeSubscriptionId: text('stripe_subscription_id'),
  createdAt:            timestamp('created_at').defaultNow().notNull(),
});

export const clients = pgTable('clients', {
  id:      text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId: text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  name:    text('name').notNull(),
  email:   text('email').notNull(),
  company: text('company'),
});

export const invoices = pgTable('invoices', {
  id:            text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  ownerId:       text('owner_id').notNull().references(() => users.id, { onDelete: 'cascade' }),
  clientId:      text('client_id').notNull().references(() => clients.id),
  reference:     text('reference').notNull(),
  currency:      currencyEnum('currency').notNull().default('GBP'),
  lineItems:     jsonb('line_items').notNull().$type<LineItem[]>(),
  issueDate:     date('issue_date').notNull(),
  dueDate:       date('due_date').notNull(),
  paidDate:      date('paid_date'),
  status:        invoiceStatusEnum('status').notNull().default('draft'),
  remindersSent: integer('reminders_sent').notNull().default(0),
  createdAt:     timestamp('created_at').defaultNow().notNull(),
});

export const chaserMessages = pgTable('chaser_messages', {
  id:                     text('id').primaryKey().$defaultFn(() => crypto.randomUUID()),
  invoiceId:              text('invoice_id').notNull().references(() => invoices.id, { onDelete: 'cascade' }),
  tone:                   text('tone').notNull(), // friendly | firm | final
  subject:                text('subject').notNull(),
  body:                   text('body').notNull(),
  citesStatutoryInterest: text('cites_statutory_interest').notNull(), // 'true'|'false'
  sentAt:                 timestamp('sent_at'),
  createdAt:              timestamp('created_at').defaultNow().notNull(),
});
