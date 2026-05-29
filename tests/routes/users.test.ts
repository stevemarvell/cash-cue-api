import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('../../src/auth/middleware.js', async () => {
  const { authPlugin } = await import('../helpers/authMock.js');
  return { authPlugin };
});

const USER_ROW = {
  id: 'user_123',
  email: 'test@example.com',
  displayName: 'Test User',
  businessName: 'Test Biz',
  tier: 'starter' as const,
  stripeCustomerId: null,
  stripeSubscriptionId: null,
  createdAt: new Date(),
};

function makeDb(userRows: object[] = [USER_ROW]) {
  const chain: any = { where: vi.fn(), limit: vi.fn() };
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(userRows);

  return {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chain) }),
    insert: vi.fn().mockReturnValue({
      values: vi.fn().mockReturnValue({
        onConflictDoUpdate: vi.fn().mockResolvedValue(undefined),
      }),
    }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('/users routes', () => {
  it('GET /users/:id returns user', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/users/user_123')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user_123');
  });

  it('GET /users/:id returns 404 for unknown user', async () => {
    const app = await buildApp({ db: makeDb([]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/users/nope')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(404);
  });

  it('GET /users?email= returns user', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/users?email=test@example.com')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(200);
    expect(res.body.email).toBe('test@example.com');
  });

  it('GET /users without email returns 400', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/users')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(400);
  });

  it('POST /users upserts and returns user', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/users')
      .set('Authorization', 'Bearer valid_token')
      .send({ id: 'user_123', email: 'test@example.com', displayName: 'Test User', businessName: 'Test Biz' });
    expect(res.status).toBe(200);
    expect(res.body.id).toBe('user_123');
  });

  it('POST /users returns 400 for invalid body', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/users')
      .set('Authorization', 'Bearer valid_token')
      .send({ id: '' });
    expect(res.status).toBe(400);
  });

  it('requires auth — no token returns 401', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).get('/users/user_123');
    expect(res.status).toBe(401);
  });
});
