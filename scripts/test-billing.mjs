import assert from 'node:assert/strict';

process.env.SUPABASE_URL ||= 'https://example.supabase.co';
process.env.SUPABASE_SERVICE_KEY ||= 'test-service-key';

const { billingConfiguration, subscriptionProfilePatch } = await import('../api/routes/stripe.js');

assert.deepEqual(billingConfiguration({}), {
  checkoutConfigured: false,
  webhookConfigured: false,
  mode: null,
  propertyPriceConfigured: false,
  subscriptionPriceConfigured: false,
});

assert.deepEqual(billingConfiguration({
  STRIPE_SECRET_KEY: 'sk_test_example',
  STRIPE_WEBHOOK_SECRET: 'whsec_example',
  STRIPE_PROPERTY_PRICE_ID: 'price_property',
  STRIPE_PRO_PRICE_ID: 'price_pro',
}), {
  checkoutConfigured: true,
  webhookConfigured: true,
  mode: 'test',
  propertyPriceConfigured: true,
  subscriptionPriceConfigured: true,
});

const now = '2026-09-23T12:00:00.000Z';
assert.deepEqual(subscriptionProfilePatch('active', 'sub_123', now), {
  plan: 'pro',
  stripe_subscription_id: 'sub_123',
  subscription_status: 'active',
  trial_ends_at: null,
  updated_at: now,
});
assert.deepEqual(subscriptionProfilePatch('past_due', 'sub_123', now), {
  plan: 'free',
  stripe_subscription_id: 'sub_123',
  subscription_status: 'past_due',
  trial_ends_at: null,
  updated_at: now,
});
assert.deepEqual(subscriptionProfilePatch('canceled', 'sub_123', now), {
  plan: 'free',
  stripe_subscription_id: null,
  subscription_status: 'canceled',
  trial_ends_at: null,
  updated_at: now,
});

console.log('Billing configuration and subscription access tests passed.');
