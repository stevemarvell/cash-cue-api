import Stripe from 'stripe';

const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!);

const PRICE_IDS: Record<string, string> = {
  starter:  process.env.STRIPE_PRICE_STARTER!,
  pro:      process.env.STRIPE_PRICE_PRO!,
  business: process.env.STRIPE_PRICE_BUSINESS!,
};

export async function subscribe(
  userId: string,
  stripeCustomerId: string | null,
  tier: string,
) {
  const priceId = PRICE_IDS[tier];
  if (!priceId) throw new Error(`Unknown tier: ${tier}`);

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: stripeCustomerId ?? undefined,
    line_items: [{ price: priceId, quantity: 1 }],
    success_url: `${process.env.FRONTEND_URL}/account?upgraded=true`,
    cancel_url:  `${process.env.FRONTEND_URL}/account`,
    metadata: { userId, tier },
  });

  return {
    tier,
    active: true,
    subscriptionId: session.id,
    checkoutUrl: session.url,
  };
}

export async function cancel(stripeSubscriptionId: string) {
  await stripe.subscriptions.cancel(stripeSubscriptionId);
}

export async function createPaymentLink(invoice: {
  id: string;
  reference: string;
  totalMinor: number;
  currency: string;
}) {
  // Stripe PaymentLinks require a Price object; create a one-off price first
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

export function constructWebhookEvent(payload: Buffer, sig: string, secret: string) {
  return stripe.webhooks.constructEvent(payload, sig, secret);
}
