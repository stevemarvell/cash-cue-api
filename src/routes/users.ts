import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import { eq } from 'drizzle-orm';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import type { CacheService } from '../cache/cache.js';
import type { User } from '../types/api.js';

const upsertUserSchema = z.object({
  id: z.string().min(1),
  email: z.string().email(),
  displayName: z.string().min(1),
  businessName: z.string().min(1),
  tier: z.enum(['starter', 'pro', 'business']).optional(),
});

function rowToUser(row: typeof users.$inferSelect): User {
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    businessName: row.businessName,
    tier: row.tier,
  };
}

export function buildUsersRoutes(db: Db, cache: CacheService): FastifyPluginAsync {
  return async (app) => {
    app.get<{ Params: { id: string } }>('/users/:id', async (request, reply) => {
      const { id } = request.params;

      const cached = await cache.get<User>(`user:${id}`);
      if (cached) return reply.send(cached);

      const rows = await db.select().from(users).where(eq(users.id, id)).limit(1);
      if (!rows.length) return reply.status(404).send({ error: 'not_found' });

      const user = rowToUser(rows[0]);
      await cache.set(`user:${id}`, user, 300_000);
      return reply.send(user);
    });

    app.get<{ Querystring: { email?: string } }>('/users', async (request, reply) => {
      const { email } = request.query;
      if (!email) return reply.status(400).send({ error: 'validation_error', issues: [{ message: 'email query param required' }] });

      const rows = await db.select().from(users).where(eq(users.email, email)).limit(1);
      if (!rows.length) return reply.status(404).send({ error: 'not_found' });
      return reply.send(rowToUser(rows[0]));
    });

    app.post('/users', async (request, reply) => {
      const result = upsertUserSchema.safeParse(request.body);
      if (!result.success) {
        return reply.status(400).send({ error: 'validation_error', issues: result.error.issues });
      }

      const data = result.data;
      await db
        .insert(users)
        .values({
          id: data.id,
          email: data.email,
          displayName: data.displayName,
          businessName: data.businessName,
          tier: data.tier ?? 'starter',
        })
        .onConflictDoUpdate({
          target: users.id,
          set: {
            email: data.email,
            displayName: data.displayName,
            businessName: data.businessName,
            ...(data.tier ? { tier: data.tier } : {}),
          },
        });

      const rows = await db.select().from(users).where(eq(users.id, data.id)).limit(1);
      const user = rowToUser(rows[0]);
      await cache.set(`user:${user.id}`, user, 300_000);
      return reply.send(user);
    });
  };
}
