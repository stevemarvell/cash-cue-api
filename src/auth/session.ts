import type { FastifyRequest } from 'fastify';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import type { User } from '../types/api.js';

export async function getSessionUser(request: FastifyRequest, db: Db): Promise<User | null> {
  const rows = await db.select().from(users).where(eq(users.id, request.clerkUserId)).limit(1);
  if (!rows.length) return null;
  const row = rows[0];
  return {
    id: row.id,
    email: row.email,
    displayName: row.displayName,
    businessName: row.businessName,
    tier: row.tier,
  };
}
