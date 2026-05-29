import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { Db } from '../db/client.js';
import { users } from '../db/schema.js';
import { eq } from 'drizzle-orm';
import { getSessionUser } from '../auth/session.js';

/**
 * Auth note: Clerk does not expose a server-side password auth REST API for
 * arbitrary backends. The correct pattern is for the frontend to use Clerk's
 * React/JS SDK to authenticate (which handles sign-in/sign-up and obtains a
 * session JWT), then pass that JWT to this backend as `Authorization: Bearer`.
 *
 * Therefore /auth/sign-in and /auth/sign-up are stub endpoints that return a
 * 501 with an explanatory message. They are left in place so the frontend's
 * HttpIdentityProvider doesn't get a 404, and to document the decision.
 *
 * The /auth/session and /auth/sign-out endpoints are fully implemented.
 */

export function buildAuthRoutes(db: Db): FastifyPluginAsync {
  return async (app) => {
    app.post('/auth/sign-in', async (_request, reply) => {
      return reply.status(501).send({
        error: 'not_implemented',
        message:
          'Sign-in must be performed client-side via the Clerk React/JS SDK. ' +
          'Obtain a session JWT from Clerk and pass it as Authorization: Bearer <token>.',
      });
    });

    app.post('/auth/sign-up', async (_request, reply) => {
      return reply.status(501).send({
        error: 'not_implemented',
        message:
          'Sign-up must be performed client-side via the Clerk React/JS SDK. ' +
          'After registration, call POST /users to upsert the user record.',
      });
    });

    app.post('/auth/sign-out', async (_request, reply) => {
      // JWT is stateless — client simply discards the token.
      // For Clerk session revocation, use Clerk's frontend SDK.
      return reply.status(204).send();
    });

    app.get('/auth/session', async (request, reply) => {
      const user = await getSessionUser(request, db);
      if (!user) {
        return reply.status(401).send({ error: 'invalid_token' });
      }
      const header = request.headers.authorization ?? '';
      const token = header.startsWith('Bearer ') ? header.slice(7) : '';
      return reply.send({ user, token });
    });
  };
}

// Zod schemas (exported for testing)
export const signInSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

export const signUpSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  displayName: z.string().min(1),
  businessName: z.string().min(1),
});
