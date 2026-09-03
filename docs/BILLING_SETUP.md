# ParcelLA Billing Setup

ParcelLA uses Stripe-hosted Checkout for card and US bank account payments.
Prices are created by the API at checkout time:

- Single Property Unlock: $10 one time
- Unlimited: $49 per month

## Railway variables

Set these variables on the ParcelLA API service:

```text
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
APP_URL=https://parcel-la.vercel.app
```

Use test-mode keys together or live-mode keys together. Never mix modes.

## Stripe payment methods

In Stripe, enable both Cards and ACH Direct Debit under Payment methods. Checkout
then offers card payment or a US bank account for both property unlocks and the
monthly subscription.

## Webhook

Create a Stripe webhook endpoint at:

```text
https://parcella-api-production.up.railway.app/api/stripe/webhook
```

Subscribe it to:

```text
checkout.session.completed
checkout.session.async_payment_succeeded
checkout.session.async_payment_failed
customer.subscription.created
customer.subscription.updated
customer.subscription.deleted
```

Copy the endpoint signing secret into `STRIPE_WEBHOOK_SECRET`. Delayed ACH
payments remain pending until Stripe sends `checkout.session.async_payment_succeeded`.
The checkout return endpoint also verifies completed sessions directly with Stripe.

## Verification

After Railway redeploys, confirm that `/api/health` reports `services.stripe: true`.
Use a Stripe test-mode card and test bank account before replacing the keys with
live-mode credentials.
