import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and, inArray } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { invoices, users, clients, chaserMessages } from '../db/schema.js';
import type { Invoice, ChaserTone } from '../types/api.js';
import { deriveStatus } from '../domain/invoice.js';
import { generateChaser as defaultGenerateChaser } from '../services/ai.js';
import { sendChaser as defaultSendChaser } from '../services/email.js';
import type { CacheService } from '../cache/cache.js';

export interface ServiceOverrides {
  generateChaser?: typeof defaultGenerateChaser;
  summariseCashFlow?: (...args: unknown[]) => Promise<string>;
  sendChaser?: typeof defaultSendChaser;
  subscribe?: (...args: unknown[]) => Promise<unknown>;
  cancel?: (...args: unknown[]) => Promise<unknown>;
  createPaymentLink?: (...args: unknown[]) => Promise<unknown>;
  constructWebhookEvent?: (...args: unknown[]) => unknown;
}

const TIER_LIMITS: Record<string, number | null> = {
  starter: 15,
  pro: 100,
  business: null,
};

const lineItemSchema = z.object({
  description: z.string().min(1),
  quantity: z.number().positive(),
  unitPriceMinor: z.number().int('unitPriceMinor must be an integer').nonnegative(),
});

const createInvoiceSchema = z.object({
  ownerId: z.string().min(1),
  clientId: z.string().min(1),
  reference: z.string().min(1),
  currency: z.enum(['GBP', 'USD', 'EUR']).default('GBP'),
  lineItems: z.array(lineItemSchema).min(1),
  issueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  paidDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  status: z.enum(['draft', 'sent', 'paid', 'overdue']).default('draft'),
  remindersSent: z.number().int().nonnegative().default(0),
});

const patchInvoiceSchema = createInvoiceSchema.partial();

const sendChaserBodySchema = z.object({
  tone: z.enum(['friendly', 'firm', 'final']),
  today: z.string().datetime().optional(),
});

function rowToInvoice(row: typeof invoices.$inferSelect): Invoice {
  return {
    id: row.id,
    ownerId: row.ownerId,
    clientId: row.clientId,
    reference: row.reference,
    currency: row.currency,
    lineItems: row.lineItems as Invoice['lineItems'],
    issueDate: row.issueDate,
    dueDate: row.dueDate,
    paidDate: row.paidDate ?? undefined,
    status: row.status,
    remindersSent: row.remindersSent,
  };
}

export function buildInvoicesRoutes(db: Db, cache: CacheService, services?: ServiceOverrides): FastifyPluginAsync {
  const generateChaser = services?.generateChaser ?? defaultGenerateChaser;
  const sendChaser = services?.sendChaser ?? defaultSendChaser;
  return async (app) => {

    // Lazy status update helper
    async function refreshStatus(invoice: Invoice): Promise<Invoice> {
      const today = new Date();
      const derived = deriveStatus(invoice, today);
      if (derived !== invoice.status) {
        await db
          .update(invoices)
          .set({ status: derived })
          .where(eq(invoices.id, invoice.id));
        return { ...invoice, status: derived };
      }
      return invoice;
    }

    app.get<{ Querystring: { ownerId?: string } }>('/invoices', async (request, reply) => {
      const { ownerId } = request.query;
      const userId = request.clerkUserId;

      if (ownerId && ownerId !== userId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const rows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.ownerId, userId));

      const result = await Promise.all(rows.map(r => refreshStatus(rowToInvoice(r))));
      return reply.send(result);
    });

    app.get<{ Params: { id: string } }>('/invoices/:id', async (request, reply) => {
      const rows = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, request.params.id), eq(invoices.ownerId, request.clerkUserId)))
        .limit(1);

      if (!rows.length) return reply.status(404).send({ error: 'not_found' });

      const invoice = await refreshStatus(rowToInvoice(rows[0]));
      return reply.send(invoice);
    });

    app.post('/invoices', async (request, reply) => {
      const result = createInvoiceSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const data = result.data;
      if (data.ownerId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      // Get user tier from DB
      const userRows = await db.select().from(users).where(eq(users.id, data.ownerId)).limit(1);
      if (!userRows.length) return reply.status(404).send({ error: 'not_found' });

      const tier = userRows[0].tier;
      const limit = TIER_LIMITS[tier];

      if (limit !== null) {
        const activeCount = await db
          .select()
          .from(invoices)
          .where(
            and(
              eq(invoices.ownerId, data.ownerId),
              inArray(invoices.status, ['draft', 'sent', 'overdue']),
            ),
          );
        if (activeCount.length >= limit) {
          return reply.status(402).send({ error: 'invoice_limit_reached', limit });
        }
      }

      const id = crypto.randomUUID();
      await db.insert(invoices).values({ id, ...data });

      const rows = await db.select().from(invoices).where(eq(invoices.id, id)).limit(1);
      return reply.status(201).send(rowToInvoice(rows[0]));
    });

    app.patch<{ Params: { id: string } }>('/invoices/:id', async (request, reply) => {
      const existing = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, request.params.id), eq(invoices.ownerId, request.clerkUserId)))
        .limit(1);

      if (!existing.length) return reply.status(404).send({ error: 'not_found' });

      const result = patchInvoiceSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const data = result.data;
      if (data.ownerId && data.ownerId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      await db
        .update(invoices)
        .set({
          clientId: data.clientId,
          reference: data.reference,
          currency: data.currency,
          lineItems: data.lineItems,
          issueDate: data.issueDate,
          dueDate: data.dueDate,
          paidDate: data.paidDate,
          status: data.status,
          remindersSent: data.remindersSent,
        })
        .where(eq(invoices.id, request.params.id));

      const rows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, request.params.id))
        .limit(1);

      return reply.send(rowToInvoice(rows[0]));
    });

    app.delete<{ Params: { id: string } }>('/invoices/:id', async (request, reply) => {
      const existing = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, request.params.id), eq(invoices.ownerId, request.clerkUserId)))
        .limit(1);

      if (!existing.length) return reply.status(404).send({ error: 'not_found' });

      await db.delete(invoices).where(eq(invoices.id, request.params.id));
      return reply.status(204).send();
    });

    // POST /invoices/:id/send-chaser
    app.post<{ Params: { id: string } }>('/invoices/:id/send-chaser', async (request, reply) => {
      const bodyResult = sendChaserBodySchema.safeParse(request.body);
      if (!bodyResult.success) {
        return reply.status(400).send({ error: 'validation_error', issues: bodyResult.error.issues });
      }

      const { tone, today: todayStr } = bodyResult.data;
      const today = todayStr ? new Date(todayStr) : new Date();

      const invoiceRows = await db
        .select()
        .from(invoices)
        .where(and(eq(invoices.id, request.params.id), eq(invoices.ownerId, request.clerkUserId)))
        .limit(1);

      if (!invoiceRows.length) return reply.status(404).send({ error: 'not_found' });

      const invoice = rowToInvoice(invoiceRows[0]);

      const clientRows = await db
        .select()
        .from(clients)
        .where(eq(clients.id, invoice.clientId))
        .limit(1);

      if (!clientRows.length) return reply.status(404).send({ error: 'not_found' });

      const clientData = {
        id: clientRows[0].id,
        ownerId: clientRows[0].ownerId,
        name: clientRows[0].name,
        email: clientRows[0].email,
        company: clientRows[0].company ?? undefined,
      };

      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, request.clerkUserId))
        .limit(1);

      if (!userRows.length) return reply.status(404).send({ error: 'not_found' });

      const user = userRows[0];

      const cacheKey = `chaser:${invoice.id}:${tone}:${today.toISOString().slice(0, 10)}`;
      const cached = await cache.get<ReturnType<typeof generateChaser> extends Promise<infer T> ? T : never>(cacheKey);
      let chaser = cached;

      if (!chaser) {
        chaser = await generateChaser(invoice, clientData, user.displayName, user.businessName, tone as ChaserTone, today);
        await cache.set(cacheKey, chaser, 300_000);
      }

      await sendChaser(
        clientData.email,
        `${user.businessName} <noreply@payflow.app>`,
        chaser.subject,
        chaser.body,
      );

      await db
        .update(invoices)
        .set({ remindersSent: invoice.remindersSent + 1 })
        .where(eq(invoices.id, invoice.id));

      const msgId = crypto.randomUUID();
      await db.insert(chaserMessages).values({
        id: msgId,
        invoiceId: invoice.id,
        tone,
        subject: chaser.subject,
        body: chaser.body,
        citesStatutoryInterest: String(chaser.citesStatutoryInterest),
        sentAt: new Date(),
      });

      return reply.send(chaser);
    });
  };
}
