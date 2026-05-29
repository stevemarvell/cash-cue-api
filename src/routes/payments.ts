import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users, invoices } from '../db/schema.js';
import { subscribe, cancel, createPaymentLink, constructWebhookEvent } from '../services/payments.js';
import { invoiceTotalMinor } from '../domain/invoice.js';
import type { Invoice } from '../types/api.js';

const subscribeBodySchema = z.object({
  userId: z.string().min(1),
  tier: z.enum(['starter', 'pro', 'business']),
});

const cancelBodySchema = z.object({
  userId: z.string().min(1),
});

const paymentLinkBodySchema = z.object({
  invoiceId: z.string().min(1),
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

export function buildPaymentsRoutes(db: Db): FastifyPluginAsync {
  return async (app) => {
    app.post('/payments/subscribe', async (request, reply) => {
      const result = subscribeBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const { userId, tier } = result.data;
      if (userId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!userRows.length) return reply.status(404).send({ error: 'not_found' });

      const user = userRows[0];
      const sub = await subscribe(userId, user.stripeCustomerId ?? null, tier);
      return reply.send({ tier: sub.tier, active: sub.active, subscriptionId: sub.subscriptionId });
    });

    app.post('/payments/cancel', async (request, reply) => {
      const result = cancelBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const { userId } = result.data;
      if (userId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const userRows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
      if (!userRows.length) return reply.status(404).send({ error: 'not_found' });

      const user = userRows[0];
      if (!user.stripeSubscriptionId) {
        return reply.status(400).send({ error: 'no_active_subscription' });
      }

      await cancel(user.stripeSubscriptionId);
      await db.update(users).set({ stripeSubscriptionId: null }).where(eq(users.id, userId));

      return reply.status(204).send();
    });

    app.post('/payments/links', async (request, reply) => {
      const result = paymentLinkBodySchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      // Business tier only
      const userRows = await db
        .select()
        .from(users)
        .where(eq(users.id, request.clerkUserId))
        .limit(1);

      if (!userRows.length) return reply.status(404).send({ error: 'not_found' });
      if (userRows[0].tier !== 'business') {
        return reply.status(403).send({ error: 'tier_required', required: 'business' });
      }

      const { invoiceId } = result.data;
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

      const link = await createPaymentLink({
        id: invoice.id,
        reference: invoice.reference,
        totalMinor: invoiceTotalMinor(invoice),
        currency: invoice.currency,
      });

      return reply.send(link);
    });

    // Stripe webhook — no auth middleware (handled by signature verification)
    app.post('/webhooks/stripe', {
      config: { rawBody: true },
    }, async (request, reply) => {
      const sig = request.headers['stripe-signature'];
      if (!sig || typeof sig !== 'string') {
        return reply.status(400).send({ error: 'missing_stripe_signature' });
      }

      let event;
      try {
        const raw = (request as unknown as { rawBody: Buffer }).rawBody;
        event = constructWebhookEvent(raw, sig, process.env.STRIPE_WEBHOOK_SECRET!);
      } catch {
        return reply.status(400).send({ error: 'invalid_stripe_signature' });
      }

      if (event.type === 'checkout.session.completed') {
        const session = event.data.object as { metadata?: { userId?: string; tier?: string }; customer?: string | null; subscription?: string | null };
        const userId = session.metadata?.userId;
        const tier = session.metadata?.tier as 'starter' | 'pro' | 'business' | undefined;
        const customerId = typeof session.customer === 'string' ? session.customer : null;
        const subscriptionId = typeof session.subscription === 'string' ? session.subscription : null;

        if (userId && tier) {
          await db
            .update(users)
            .set({
              tier,
              stripeCustomerId: customerId ?? undefined,
              stripeSubscriptionId: subscriptionId ?? undefined,
            })
            .where(eq(users.id, userId));
        }
      }

      if (event.type === 'customer.subscription.deleted') {
        const sub = event.data.object as { id: string };
        await db
          .update(users)
          .set({ tier: 'starter', stripeSubscriptionId: null })
          .where(eq(users.stripeSubscriptionId, sub.id));
      }

      return reply.status(200).send({ received: true });
    });
  };
}
