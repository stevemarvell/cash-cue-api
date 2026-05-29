import { verifyToken } from '@clerk/backend';
import fp from 'fastify-plugin';
import type { FastifyRequest } from 'fastify';

declare module 'fastify' {
  interface FastifyRequest {
    clerkUserId: string;
  }
}

const PUBLIC_PATHS = ['/health', '/auth/sign-in', '/auth/sign-up', '/webhooks/stripe'];

export const authPlugin = fp(async (app) => {
  app.addHook('preHandler', async (request: FastifyRequest, reply) => {
    if (PUBLIC_PATHS.some(p => request.url.startsWith(p))) return;

    const header = request.headers.authorization;
    if (!header?.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'missing_token' });
    }

    const token = header.slice(7);
    try {
      const payload = await verifyToken(token, {
        secretKey: process.env.CLERK_SECRET_KEY!,
      });
      request.clerkUserId = payload.sub;
    } catch {
      return reply.status(401).send({ error: 'invalid_token' });
    }
  });
});
