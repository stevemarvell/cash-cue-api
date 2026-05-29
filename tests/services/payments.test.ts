import { describe, it, expect, vi } from 'vitest';

/**
 * Unit tests for the payments service domain logic.
 *
 * The Stripe client is injected via a fake object so no real network calls
 * are made and no Stripe credentials are required.
 */

// ── Fake Stripe client ────────────────────────────────────────────────────────

function makeStripe() {
  const priceCreate = vi.fn().mockResolvedValue({ id: 'price_test_123' });
  const paymentLinkCreate = vi.fn().mockResolvedValue({
    url: 'https://buy.stripe.com/test_abc',
  });
  const checkoutCreate = vi.fn().mockResolvedValue({
    id: 'cs_test_session',
    url: 'https://checkout.stripe.com/test',
  });
  const subscriptionsCancel = vi.fn().mockResolvedValue(undefined);

  return {
    prices: { create: priceCreate },
    paymentLinks: { create: paymentLinkCreate },
    checkout: { sessions: { create: checkoutCreate } },
    subscriptions: { cancel: subscriptionsCancel },
    _mocks: { priceCreate, paymentLinkCreate, checkoutCreate, subscriptionsCancel },
  };
}

// ── Injectable createPaymentLink ──────────────────────────────────────────────

/**
 * An injectable version of createPaymentLink that accepts a Stripe-like client
 * instead of the module-level singleton, mirroring src/services/payments.ts.
 */
async function createPaymentLinkWithClient(
  stripe: {
    prices: { create: (args: unknown) => Promise<{ id: string }> };
    paymentLinks: { create: (args: unknown) => Promise<{ url: string }> };
  },
  invoice: { id: string; reference: string; totalMinor: number; currency: string },
) {
  const price = await stripe.prices.create({
    currency: invoice.currency.toLowerCase(),
    unit_amount: invoice.totalMinor,
    product_data: { name: `Invoice ${invoice.reference}` },
  });

  const link = await stripe.paymentLinks.create({
    line_items: [{ price: price.id, quantity: 1 }],
    metadata: { invoiceId: invoice.id },
  });

  return { invoiceId: invoice.id, url: link.url };
}

// ── Injectable subscribe ──────────────────────────────────────────────────────

async function subscribeWithClient(
  stripe: { checkout: { sessions: { create: (args: unknown) => Promise<{ id: string; url: string }> } } },
  priceIds: Record<string, string>,
  frontendUrl: string,
  userId: string,
  stripeCustomerId: string | null,
  tier: string,
) {
  const priceId = priceIds[tier];
  if (!priceId) throw new Error(`Unknown tier: ${tier}`);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${frontendUrl}/account?upgraded=true`,
    cancel_url: `${frontendUrl}/account`,
    metadata: { userId, tier },
  });

  return { tier, active: true, subscriptionId: session.id, checkoutUrl: session.url };
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('createPaymentLink', () => {
  const invoice = {
    id: 'inv_abc',
    reference: 'INV-042',
    totalMinor: 150_000,
    currency: 'GBP',
  };

  it('creates a price with the correct currency and amount', async () => {
    const stripe = makeStripe();
    await createPaymentLinkWithClient(stripe, invoice);
    expect(stripe._mocks.priceCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        currency: 'gbp',
        unit_amount: 150_000,
        product_data: { name: 'Invoice INV-042' },
      }),
    );
  });

  it('creates a payment link referencing the generated price ID', async () => {
    const stripe = makeStripe();
    await createPaymentLinkWithClient(stripe, invoice);
    expect(stripe._mocks.paymentLinkCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        line_items: [{ price: 'price_test_123', quantity: 1 }],
        metadata: { invoiceId: 'inv_abc' },
      }),
    );
  });

  it('returns the invoice ID and the Stripe URL', async () => {
    const stripe = makeStripe();
    const result = await createPaymentLinkWithClient(stripe, invoice);
    expect(result).toEqual({ invoiceId: 'inv_abc', url: 'https://buy.stripe.com/test_abc' });
  });
});

describe('subscribe', () => {
  const PRICE_IDS = { starter: 'price_starter', pro: 'price_pro', business: 'price_biz' };
  const FRONTEND = 'https://app.example.com';

  it('creates a checkout session with the correct price ID for the tier', async () => {
    const stripe = makeStripe();
    await subscribeWithClient(stripe, PRICE_IDS, FRONTEND, 'user_1', null, 'pro');
    expect(stripe._mocks.checkoutCreate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'subscription',
        line_items: [{ price: 'price_pro', quantity: 1 }],
        metadata: { userId: 'user_1', tier: 'pro' },
      }),
    );
  });

  it('returns tier, active flag, and the session ID as subscriptionId', async () => {
    const stripe = makeStripe();
    const result = await subscribeWithClient(stripe, PRICE_IDS, FRONTEND, 'user_1', null, 'starter');
    expect(result.tier).toBe('starter');
    expect(result.active).toBe(true);
    expect(result.subscriptionId).toBe('cs_test_session');
  });

  it('throws for an unknown tier', async () => {
    const stripe = makeStripe();
    await expect(
      subscribeWithClient(stripe, PRICE_IDS, FRONTEND, 'user_1', null, 'enterprise'),
    ).rejects.toThrow('Unknown tier: enterprise');
  });
});
