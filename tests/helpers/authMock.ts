import fp from 'fastify-plugin';

/** Auth middleware mock. Sets clerkUserId = 'user_123' for Bearer valid_token, 401 otherwise. */
export const authPlugin = fp(async (app: any) => {
  app.addHook('preHandler', async (req: any, reply: any) => {
    const pub = ['/health', '/auth/sign-in', '/auth/sign-up', '/webhooks/stripe'];
    if (pub.some((p: string) => req.url.startsWith(p))) return;
    const header: string = req.headers.authorization ?? '';
    if (!header.startsWith('Bearer ')) {
      return reply.status(401).send({ error: 'missing_token' });
    }
    const token = header.slice(7);
    if (token === 'valid_token') {
      req.clerkUserId = 'user_123';
    } else {
      return reply.status(401).send({ error: 'invalid_token' });
    }
  });
});
