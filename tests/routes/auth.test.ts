import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('@clerk/backend', () => ({
  verifyToken: vi.fn(async (token: string) => {
    if (token === 'valid_token') return { sub: 'user_clerk_123' };
    throw new Error('Invalid token');
  }),
}));

function makeDb(userRow?: object) {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockReturnValue({
          limit: vi.fn().mockResolvedValue(userRow ? [userRow] : []),
        }),
      }),
    }),
  };
}

describe('Auth routes', () => {
  it('POST /auth/sign-in returns 501 (Clerk handles client-side)', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).post('/auth/sign-in').send({ email: 'x@x.com', password: 'pw' });
    expect(res.status).toBe(501);
  });

  it('POST /auth/sign-up returns 501', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).post('/auth/sign-up').send({ email: 'x@x.com', password: 'pw', displayName: 'X', businessName: 'B' });
    expect(res.status).toBe(501);
  });

  it('GET /auth/session returns 401 with missing token', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).get('/auth/session');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('missing_token');
  });

  it('GET /auth/session returns 401 with invalid token', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).get('/auth/session').set('Authorization', 'Bearer bad_token');
    expect(res.status).toBe(401);
    expect(res.body.error).toBe('invalid_token');
  });

  it('GET /auth/session returns 401 when user not in DB', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/auth/session')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(401);
  });

  it('GET /auth/session returns user when token valid and user exists', async () => {
    const userRow = {
      id: 'user_clerk_123',
      email: 'test@test.com',
      displayName: 'Test User',
      businessName: 'Test Biz',
      tier: 'starter',
    };
    const app = await buildApp({ db: makeDb(userRow) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/auth/session')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(200);
    expect(res.body.user.id).toBe('user_clerk_123');
    expect(res.body.token).toBe('valid_token');
  });

  it('POST /auth/sign-out returns 204', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/auth/sign-out')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(204);
  });
});
