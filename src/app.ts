import Fastify from 'fastify';
import cors from '@fastify/cors';
import { authPlugin } from './auth/middleware.js';
import { healthRoutes } from './routes/health.js';
import { buildAuthRoutes } from './routes/auth.js';
import { buildUsersRoutes } from './routes/users.js';
import { buildClientsRoutes } from './routes/clients.js';
import { buildInvoicesRoutes } from './routes/invoices.js';
import { buildAiRoutes } from './routes/ai.js';
import { buildPaymentsRoutes } from './routes/payments.js';
import { getDb } from './db/client.js';
import { RedisCacheService, MemoryCacheService, type CacheService } from './cache/cache.js';
import { getRedis } from './cache/client.js';
import type { Db } from './db/client.js';
import type { ServiceOverrides } from './routes/invoices.js';

export interface AppOptions {
  db?: Db;
  cache?: CacheService;
  services?: ServiceOverrides;
  logger?: boolean | object;
  trustProxy?: boolean;
}

export async function buildApp(opts: AppOptions = {}) {
  const db = opts.db ?? getDb();
  const cache = opts.cache ?? (() => {
    try {
      return new RedisCacheService(getRedis());
    } catch {
      return new MemoryCacheService();
    }
  })();

  const app = Fastify({
    logger: opts.logger ?? {
      level: process.env.NODE_ENV === 'test' ? 'silent' : 'info',
    },
    trustProxy: opts.trustProxy ?? true,
  });

  // CORS
  await app.register(cors, {
    origin: process.env.FRONTEND_URL ?? 'http://localhost:5173',
    credentials: true,
  });

  // Raw body for Stripe webhook
  app.addContentTypeParser('application/json', { parseAs: 'buffer' }, (req, body, done) => {
    try {
      (req as unknown as { rawBody: Buffer }).rawBody = body as Buffer;
      done(null, JSON.parse((body as Buffer).toString()));
    } catch (err) {
      done(err as Error, undefined);
    }
  });

  // Auth middleware (skips public routes)
  await app.register(authPlugin);

  // Routes
  await app.register(healthRoutes);
  await app.register(buildAuthRoutes(db));
  await app.register(buildUsersRoutes(db, cache));
  await app.register(buildClientsRoutes(db));
  await app.register(buildInvoicesRoutes(db, cache, opts.services));
  await app.register(buildAiRoutes(db, cache, opts.services));
  await app.register(buildPaymentsRoutes(db, opts.services));

  // Global error handler
  app.setErrorHandler((error: Error, _request, reply) => {
    app.log.error(error);
    if (reply.statusCode >= 400 && reply.statusCode < 500) {
      return reply.send({ error: error.message });
    }
    return reply.status(500).send({ error: 'internal_server_error' });
  });

  await app.ready();
  return app;
}
