import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('../../src/auth/middleware.js', async () => {
  const { authPlugin } = await import('../helpers/authMock.js');
  return { authPlugin };
});

vi.mock('../../src/services/ai.js', () => ({
  generateChaser: vi.fn().mockResolvedValue({
    invoiceId: 'inv_1', tone: 'friendly', subject: 'Invoice reminder',
    body: 'Please pay your invoice.', citesStatutoryInterest: false,
  }),
  summariseCashFlow: vi.fn().mockResolvedValue('You have £1,000 outstanding.'),
}));

const INVOICE_ROW = {
  id: 'inv_1', ownerId: 'user_123', clientId: 'client_1', reference: 'INV-001',
  currency: 'GBP', lineItems: [{ description: 'Work', quantity: 1, unitPriceMinor: 100000 }],
  issueDate: '2025-01-01', dueDate: '2025-01-31', paidDate: null, status: 'overdue', remindersSent: 0, createdAt: new Date(),
};

const CLIENT_ROW = { id: 'client_1', ownerId: 'user_123', name: 'Acme', email: 'acme@example.com', company: null };
const USER_ROW = { id: 'user_123', email: 'test@example.com', displayName: 'Test', businessName: 'Test Biz', tier: 'starter' };

function makeDb() {
  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        callCount++;
        const chain: any = { where: vi.fn(), limit: vi.fn() };
        chain.where.mockReturnValue(chain);
        const rows = callCount === 1 ? [INVOICE_ROW] : callCount === 2 ? [CLIENT_ROW] : [USER_ROW];
        chain.limit.mockResolvedValue(rows);
        return chain;
      }),
    })),
  };
}

function makeDbForCashflow() {
  return {
    select: vi.fn().mockReturnValue({
      from: vi.fn().mockReturnValue({
        where: vi.fn().mockResolvedValue([INVOICE_ROW]),
      }),
    }),
  };
}

describe('/ai routes', () => {
  it('requires auth', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).post('/ai/chaser').send({});
    expect(res.status).toBe(401);
  });

  it('POST /ai/chaser validates body', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/ai/chaser')
      .set('Authorization', 'Bearer valid_token')
      .send({ invoiceId: 'inv_1' }); // missing tone and today
    expect(res.status).toBe(400);
  });

  it('POST /ai/chaser returns chaser message', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/ai/chaser')
      .set('Authorization', 'Bearer valid_token')
      .send({ invoiceId: 'inv_1', tone: 'friendly', today: '2025-06-01T00:00:00.000Z' });
    expect(res.status).toBe(200);
    expect(res.body.subject).toBe('Invoice reminder');
    expect(res.body.citesStatutoryInterest).toBe(false);
  });

  it('POST /ai/chaser returns cached response on second call', async () => {
    const cache = new MemoryCacheService();
    const app = await buildApp({ db: makeDb() as any, cache, logger: false });
    const { generateChaser } = await import('../../src/services/ai.js');

    const body = { invoiceId: 'inv_1', tone: 'friendly', today: '2025-06-01T00:00:00.000Z' };
    await request(app.server).post('/ai/chaser').set('Authorization', 'Bearer valid_token').send(body);
    const callsBefore = vi.mocked(generateChaser).mock.calls.length;
    await request(app.server).post('/ai/chaser').set('Authorization', 'Bearer valid_token').send(body);
    expect(vi.mocked(generateChaser).mock.calls.length).toBe(callsBefore);
  });

  it('POST /ai/cashflow-summary validates body', async () => {
    const app = await buildApp({ db: makeDbForCashflow() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/ai/cashflow-summary')
      .set('Authorization', 'Bearer valid_token')
      .send({ invoiceIds: [] }); // empty array should fail
    expect(res.status).toBe(400);
  });
});
