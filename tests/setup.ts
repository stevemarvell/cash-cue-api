// Set required env vars for all tests
process.env.NODE_ENV = 'test';
process.env.DATABASE_URL = 'postgresql://localhost/test';
process.env.REDIS_URL = 'redis://localhost:6379';
process.env.CLERK_SECRET_KEY = 'sk_test_clerk_key';
process.env.ANTHROPIC_API_KEY = 'sk-ant-test';
process.env.STRIPE_SECRET_KEY = 'sk_test_stripe';
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test';
process.env.STRIPE_PRICE_STARTER = 'price_starter';
process.env.STRIPE_PRICE_PRO = 'price_pro';
process.env.STRIPE_PRICE_BUSINESS = 'price_business';
process.env.RESEND_API_KEY = 're_test';
process.env.FRONTEND_URL = 'http://localhost:5173';
process.env.BOE_BASE_RATE = '0.0475';
