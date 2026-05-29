import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, inArray, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { invoices, clients, users } from '../db/schema.js';
import { generateChaser as defaultGenerateChaser, summariseCashFlow as defaultSummariseCashFlow } from '../services/ai.js';
import type { CacheService } from '../cache/cache.js';
import type { Invoice, ChaserTone } from '../types/api.js';
import type { ServiceOverrides } from './invoices.js';
import { createHash } from 'crypto';

const chaserBodySchema = z.object({
  invoiceId: z.string().min(1),
  tone: z.enum(['friendly', 'firm', 'final']),
  today: z.string().datetime(),
});

const cashflowBodySchema = z.object({
  invoiceIds: z.array(z.string().min(1)).min(1),
  today: z.string().datetime(),
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

export function buildAiRoutes(db: Db, cache: CacheService, services?: ServiceOverrides): FastifyPluginAsync {
  const generateChaser = services?.generateChaser ?? defaultGenerateChaser;
  const summariseCashFlow = (services?.summariseCashFlow as typeof defaultSummariseCashFlow | undefined) ?? defaultSummariseCashFlow;
  return async (app) => {
    app.post('/ai/chaser', async (request, reply) => {
      const result = chaserBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const { invoiceId, tone, today: todayStr } = result.data;
      const today = new Date(todayStr);
      const todayDate = today.toISOString().slice(0, 10);

      const cacheKey = `chaser:${invoiceId}:${tone}:${todayDate}`;
      const cached = await cache.get(cacheKey);
      if (cached) return reply.send(cached);

      const invoiceRows = await db
        .select()
        .from(invoices)
        .where(eq(invoices.id, invoiceId))
        .limit(1);

      if (!invoiceRows.length) return reply.status(404).send({ error: 'not_found' });

      const invoice = rowToInvoice(invoiceRows[0]);
      if (invoice.ownerId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

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

      const chaser = await generateChaser(
        invoice,
        clientData,
        user.displayName,
        user.businessName,
        tone as ChaserTone,
        today,
      );

      await cache.set(cacheKey, chaser, 300_000);
      return reply.send(chaser);
    });

    app.post('/ai/cashflow-summary', async (request, reply) => {
      const result = cashflowBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const { invoiceIds, today: todayStr } = result.data;
      const today = new Date(todayStr);
      const todayDate = today.toISOString().slice(0, 10);

      const sortedIds = invoiceIds.slice().sort();
      const hash = createHash('sha256').update(sortedIds.join(',')).digest('hex').slice(0, 16);
      const cacheKey = `cashflow-summary:${hash}:${todayDate}`;
      const cached = await cache.get<{ summary: string }>(cacheKey);
      if (cached) return reply.send(cached);

      const whereClause = invoiceIds.length === 1
        ? and(eq(invoices.id, invoiceIds[0]), eq(invoices.ownerId, request.clerkUserId))
        : and(inArray(invoices.id, invoiceIds), eq(invoices.ownerId, request.clerkUserId));

      const rows = await db.select().from(invoices).where(whereClause);
      const invoiceList = rows.map(rowToInvoice);

      const summary = await summariseCashFlow(invoiceList, today);
      const payload = { summary };
      await cache.set(cacheKey, payload, 60_000);
      return reply.send(payload);
    });
  };
}
