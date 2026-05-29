import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('../../src/auth/middleware.js', async () => {
  const { authPlugin } = await import('../helpers/authMock.js');
  return { authPlugin };
});

const CLIENT_ROW = {
  id: 'client_1',
  ownerId: 'user_123',
  name: 'Acme Corp',
  email: 'acme@example.com',
  company: 'Acme Ltd',
};

function makeDb(clientRows: object[] = [CLIENT_ROW]) {
  const chain: any = { where: vi.fn(), limit: vi.fn() };
  chain.where.mockReturnValue(chain);
  chain.limit.mockResolvedValue(clientRows);

  return {
    select: vi.fn().mockReturnValue({ from: vi.fn().mockReturnValue(chain) }),
    insert: vi.fn().mockReturnValue({ values: vi.fn().mockResolvedValue(undefined) }),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
    delete: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
  };
}

describe('/clients routes', () => {
  it('requires auth', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).get('/clients');
    expect(res.status).toBe(401);
  });

  it('GET /clients/:id returns 404 for unknown', async () => {
    const app = await buildApp({ db: makeDb([]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/clients/nope')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(404);
  });

  it('GET /clients/:id returns client owned by user', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .get('/clients/client_1')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(200);
    expect(res.body.name).toBe('Acme Corp');
  });

  it('POST /clients validates body', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/clients')
      .set('Authorization', 'Bearer valid_token')
      .send({ name: '' });
    expect(res.status).toBe(400);
  });

  it('POST /clients returns 403 if ownerId mismatch', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/clients')
      .set('Authorization', 'Bearer valid_token')
      .send({ ownerId: 'user_456', name: 'Test', email: 'test@test.com' });
    expect(res.status).toBe(403);
  });

  it('DELETE /clients/:id returns 404 when not found', async () => {
    const app = await buildApp({ db: makeDb([]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .delete('/clients/nope')
      .set('Authorization', 'Bearer valid_token');
    expect(res.status).toBe(404);
  });
});
