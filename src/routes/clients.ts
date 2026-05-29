import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq, and } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { clients } from '../db/schema.js';
import type { Client } from '../types/api.js';

const createClientSchema = z.object({
  ownerId: z.string().min(1),
  name: z.string().min(1),
  email: z.string().email(),
  company: z.string().optional(),
});

const patchClientSchema = createClientSchema.partial();

function rowToClient(row: typeof clients.$inferSelect): Client {
  return {
    id: row.id,
    ownerId: row.ownerId,
    name: row.name,
    email: row.email,
    company: row.company ?? undefined,
  };
}

export function buildClientsRoutes(db: Db): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Querystring: { ownerId?: string } }>('/clients', async (request, reply) => {
      const { ownerId } = request.query;
      const userId = request.clerkUserId;

      const effectiveOwnerId = ownerId ?? userId;
      if (effectiveOwnerId !== userId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const rows = await db.select().from(clients).where(eq(clients.ownerId, userId));
      return reply.send(rows.map(rowToClient));
    });

    app.get<{ Params: { id: string } }>('/clients/:id', async (request, reply) => {
      const rows = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, request.params.id), eq(clients.ownerId, request.clerkUserId)))
        .limit(1);

      if (!rows.length) return reply.status(404).send({ error: 'not_found' });
      return reply.send(rowToClient(rows[0]));
    });

    app.post('/clients', async (request, reply) => {
      const result = createClientSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const data = result.data;
      if (data.ownerId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      const id = crypto.randomUUID();
      await db.insert(clients).values({ id, ...data });

      const rows = await db.select().from(clients).where(eq(clients.id, id)).limit(1);
      return reply.status(201).send(rowToClient(rows[0]));
    });

    app.patch<{ Params: { id: string } }>('/clients/:id', async (request, reply) => {
      const existing = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, request.params.id), eq(clients.ownerId, request.clerkUserId)))
        .limit(1);

      if (!existing.length) return reply.status(404).send({ error: 'not_found' });

      const result = patchClientSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const data = result.data;
      if (data.ownerId && data.ownerId !== request.clerkUserId) {
        return reply.status(403).send({ error: 'forbidden' });
      }

      await db
        .update(clients)
        .set({ name: data.name, email: data.email, company: data.company })
        .where(eq(clients.id, request.params.id));

      const rows = await db
        .select()
        .from(clients)
        .where(eq(clients.id, request.params.id))
        .limit(1);

      return reply.send(rowToClient(rows[0]));
    });

    app.delete<{ Params: { id: string } }>('/clients/:id', async (request, reply) => {
      const existing = await db
        .select()
        .from(clients)
        .where(and(eq(clients.id, request.params.id), eq(clients.ownerId, request.clerkUserId)))
        .limit(1);

      if (!existing.length) return reply.status(404).send({ error: 'not_found' });

      await db.delete(clients).where(eq(clients.id, request.params.id));
      return reply.status(204).send();
    });
  };
}
