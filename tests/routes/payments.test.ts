import { describe, it, expect, vi } from 'vitest';
import request from 'supertest';
import { buildApp } from '../../src/app.js';
import { MemoryCacheService } from '../../src/cache/cache.js';

vi.mock('../../src/auth/middleware.js', async () => {
  const { authPlugin } = await import('../helpers/authMock.js');
  return { authPlugin };
});

vi.mock('../../src/services/payments.js', () => ({
  subscribe: vi.fn().mockResolvedValue({
    tier: 'pro', active: true, subscriptionId: 'sess_123', checkoutUrl: 'https://checkout.stripe.com',
  }),
  cancel: vi.fn().mockResolvedValue(undefined),
  createPaymentLink: vi.fn().mockResolvedValue({ invoiceId: 'inv_1', url: 'https://pay.stripe.com/link' }),
  constructWebhookEvent: vi.fn().mockImplementation(() => ({
    type: 'checkout.session.completed',
    data: { object: { metadata: { userId: 'user_123', tier: 'pro' }, customer: 'cus_123', subscription: 'sub_123' } },
  })),
}));

const USER_ROW = (tier = 'starter', subId: string | null = null) => ({
  id: 'user_123', email: 'test@example.com', displayName: 'Test', businessName: 'Biz',
  tier, stripeCustomerId: null, stripeSubscriptionId: subId,
});

const INVOICE_ROW = {
  id: 'inv_1', ownerId: 'user_123', clientId: 'client_1', reference: 'INV-001',
  currency: 'GBP', lineItems: [{ description: 'Work', quantity: 1, unitPriceMinor: 100000 }],
  issueDate: '2025-01-01', dueDate: '2025-01-31', paidDate: null, status: 'sent', remindersSent: 0,
};

function makeDb(userRow = USER_ROW(), invoiceRows: object[] = []) {
  let callCount = 0;
  return {
    select: vi.fn().mockImplementation(() => ({
      from: vi.fn().mockImplementation(() => {
        callCount++;
        const chain: any = { where: vi.fn(), limit: vi.fn() };
        chain.where.mockReturnValue(chain);
        chain.limit.mockResolvedValue(callCount === 1 ? [userRow] : invoiceRows);
        return chain;
      }),
    })),
    update: vi.fn().mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) }),
    }),
  };
}

describe('/payments routes', () => {
  it('requires auth', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server).post('/payments/subscribe').send({});
    expect(res.status).toBe(401);
  });

  it('POST /payments/subscribe returns subscription result', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/payments/subscribe')
      .set('Authorization', 'Bearer valid_token')
      .send({ userId: 'user_123', tier: 'pro' });
    expect(res.status).toBe(200);
    expect(res.body.tier).toBe('pro');
    expect(res.body.active).toBe(true);
  });

  it('POST /payments/subscribe returns 403 for userId mismatch', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/payments/subscribe')
      .set('Authorization', 'Bearer valid_token')
      .send({ userId: 'user_other', tier: 'pro' });
    expect(res.status).toBe(403);
  });

  it('POST /payments/cancel returns 400 with no subscription', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/payments/cancel')
      .set('Authorization', 'Bearer valid_token')
      .send({ userId: 'user_123' });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe('no_active_subscription');
  });

  it('POST /payments/links returns 403 for non-business tier', async () => {
    const app = await buildApp({ db: makeDb(USER_ROW('starter')) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/payments/links')
      .set('Authorization', 'Bearer valid_token')
      .send({ invoiceId: 'inv_1' });
    expect(res.status).toBe(403);
    expect(res.body.error).toBe('tier_required');
    expect(res.body.required).toBe('business');
  });

  it('POST /payments/links returns payment link for business tier', async () => {
    const app = await buildApp({ db: makeDb(USER_ROW('business'), [INVOICE_ROW]) as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/payments/links')
      .set('Authorization', 'Bearer valid_token')
      .send({ invoiceId: 'inv_1' });
    expect(res.status).toBe(200);
    expect(res.body.url).toContain('stripe.com');
  });

  it('POST /webhooks/stripe returns 400 for missing signature', async () => {
    const app = await buildApp({ db: makeDb() as any, cache: new MemoryCacheService(), logger: false });
    const res = await request(app.server)
      .post('/webhooks/stripe')
      .send({});
    expect(res.status).toBe(400);
  });
});
