import { z } from 'zod';

const schema = z.object({
  NODE_ENV:              z.enum(['development', 'production', 'test']).default('development'),
  PORT:                  z.coerce.number().default(3000),
  DATABASE_URL:          z.string().url(),
  REDIS_URL:             z.string().url(),
  CLERK_SECRET_KEY:      z.string().min(1),
  ANTHROPIC_API_KEY:     z.string().min(1),
  STRIPE_SECRET_KEY:     z.string().min(1),
  STRIPE_WEBHOOK_SECRET: z.string().min(1),
  STRIPE_PRICE_STARTER:  z.string().min(1),
  STRIPE_PRICE_PRO:      z.string().min(1),
  STRIPE_PRICE_BUSINESS: z.string().min(1),
  RESEND_API_KEY:        z.string().min(1),
  FRONTEND_URL:          z.string().url().default('http://localhost:5173'),
  BOE_BASE_RATE:         z.coerce.number().default(0.0475),
  BOE_RATE_UPDATED_AT:   z.string().optional(),
});

export const config = schema.parse(process.env);

// Warn if BoE rate is stale (>90 days)
if (config.BOE_RATE_UPDATED_AT) {
  const updatedAt = new Date(config.BOE_RATE_UPDATED_AT);
  const ageMs = Date.now() - updatedAt.getTime();
  const ageDays = ageMs / 86_400_000;
  if (ageDays > 90) {
    console.warn(
      `[config] BOE_BASE_RATE was last updated ${Math.floor(ageDays)} days ago — verify it is current`,
    );
  }
}
