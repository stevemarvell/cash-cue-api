import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('../../src/auth/middleware.js', async () => {
  const { authPlugin } = await import('../helpers/authMock.js');
  return { authPlugin };
});

describe('GET /health', () => {
  it('returns 200 with status ok', async () => {
    const app = await buildApp({ db: {} as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.timestamp).toBe('string');
  });
});
