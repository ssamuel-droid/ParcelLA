/**
 * ParceLLA — Stripe Billing Router
 *
 * Plans:
 *   free        — redacted browsing and sample exports
 *   property    — $10 one-time unlock for one property
 *   pro         — $49/mo unlimited full-property access
 *
 * Setup:
 *   npm install stripe
 *   STRIPE_SECRET_KEY=sk_live_xxx
 *   STRIPE_WEBHOOK_SECRET=whsec_xxx
 *
 * Routes:
 *   POST /api/stripe/checkout     — create Stripe checkout session
 *   POST /api/stripe/portal       — customer portal (manage/cancel)
 *   POST /api/stripe/webhook      — Stripe webhook handler
 *   GET  /api/stripe/plans        — list available plans
 */

import { Router }      from 'express';
import { createClient } from '@supabase/supabase-js';
import Stripe from 'stripe';
import { randomUUID } from 'crypto';
import { requireAuth, ensureUserProfile, getUnlockedSiteIdsFast } from '../middleware/auth.js';

const router = Router();
function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Lazy-load Stripe so server starts without the key
let _stripe = null;
function stripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }
  return _stripe;
}

const PLANS = {
  free: {
    name:        'Free',
    price:       0,
    billing:      'free',
    features:    ['Redacted property browsing', 'Core underwriting preview', 'Sample PDF and Excel downloads'],
    limits:      { sitesPerDay: 20, modelsPerDay: 10, pdf: 'sample', alerts: 1, aiNarrative: false },
  },
  property: {
    name:        'Single Property Unlock',
    price:       10,
    billing:     'one_time',
    features:    ['Full address for one property', 'Owner and sale records', 'Planning documents', 'Full PDF and Excel exports'],
    limits:      { sitesPerDay: 20, modelsPerDay: 10, pdf: true, alerts: 1, aiNarrative: true },
  },
  pro: {
    name:        'Unlimited',
    price:       49,
    billing:     'monthly',
    features:    ['Full addresses and maps', 'Owner/sale data when available', 'Unlimited searches', 'PDF deal memos', 'Excel export', 'Deal sharing'],
    limits:      { sitesPerDay: Infinity, modelsPerDay: Infinity, pdf: true, alerts: 20, aiNarrative: true },
  },
};

const CHECKOUT_PAYMENT_METHODS = ['card', 'us_bank_account'];
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const CURRENT_TERMS_VERSION = '2026-09-07';

export function billingConfiguration(env = process.env) {
  const secretKey = String(env.STRIPE_SECRET_KEY || '');
  const webhookSecret = String(env.STRIPE_WEBHOOK_SECRET || '');
  return {
    checkoutConfigured: /^sk_(test|live)_/.test(secretKey),
    webhookConfigured: /^whsec_/.test(webhookSecret),
    mode: secretKey.startsWith('sk_live_') ? 'live' : secretKey.startsWith('sk_test_') ? 'test' : null,
    propertyPriceConfigured: /^price_/.test(String(env.STRIPE_PROPERTY_PRICE_ID || '')),
    subscriptionPriceConfigured: /^price_/.test(String(env.STRIPE_PRO_PRICE_ID || '')),
  };
}

export function subscriptionProfilePatch(status, subscriptionId, now = new Date().toISOString()) {
  const normalizedStatus = status || 'incomplete';
  const active = ACTIVE_SUBSCRIPTION_STATUSES.has(normalizedStatus);
  return {
    plan: active ? 'pro' : 'free',
    stripe_subscription_id: normalizedStatus === 'canceled' ? null : subscriptionId,
    subscription_status: normalizedStatus,
    trial_ends_at: null,
    updated_at: now,
  };
}

function requireCheckoutConfigured(res) {
  const config = billingConfiguration();
  if (config.checkoutConfigured && config.webhookConfigured) return true;
  res.status(503).json({ error: 'Secure checkout is being configured. No payment was attempted.' });
  return false;
}

function appUrl() {
  return String(process.env.APP_URL || 'https://parcel-la.vercel.app').replace(/\/$/, '');
}

function returnUrlForRequest(req) {
  const origin = String(req.get('origin') || '').replace(/\/$/, '');
  if (/^https:\/\/parcel-la(?:-[a-z0-9-]+)?\.vercel\.app$/i.test(origin)) return origin;
  if (/^http:\/\/(?:127\.0\.0\.1|localhost)(?::\d+)?$/i.test(origin)) return origin;
  return appUrl();
}

async function customerForUser(user) {
  const profile = await ensureUserProfile(user);

  if (profile?.stripe_customer_id) return profile.stripe_customer_id;
  const customer = await stripe().customers.create({
    email: user.email,
    metadata: { supabase_uid: user.id },
  }, { idempotencyKey: `parcella-customer-${user.id}` });
  const { error } = await sb()
    .from('profiles').update({ stripe_customer_id: customer.id }).eq('id', user.id);
  if (error) throw error;
  return customer.id;
}

async function billableSiteExists(siteId) {
  const id = Number.parseInt(siteId, 10);
  if (!id) return false;
  const [{ data: site }, { data: permit }] = await Promise.all([
    sb().from('sites').select('id').eq('id', id).maybeSingle(),
    sb().from('permits').select('id').eq('id', id).maybeSingle(),
  ]);
  return !!(site || permit);
}

async function recordBillingEvent({ id, type, data }, userId = null) {
  const { error } = await sb().from('subscription_events').upsert({
    stripe_event_id: id,
    event_type: type,
    user_id: userId || data?.object?.metadata?.user_id || null,
    stripe_data: data?.object || {},
  }, { onConflict: 'stripe_event_id', ignoreDuplicates: true });
  if (error) throw error;
}

async function hasAcceptedCurrentTerms(userId) {
  if (process.env.TERMS_ENFORCEMENT_ENABLED !== 'true') return true;
  const { data, error } = await sb()
    .from('terms_acceptances')
    .select('id')
    .eq('user_id', userId)
    .eq('terms_version', CURRENT_TERMS_VERSION)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

async function persistPropertyEntitlement(session) {
  const metadata = session?.metadata || {};
  const entitlement = {
    user_id: metadata.user_id,
    site_id: String(metadata.site_id || ''),
    stripe_checkout_session_id: session.id,
    stripe_payment_intent_id: typeof session.payment_intent === 'string' ? session.payment_intent : session.payment_intent?.id || null,
    amount_paid: Number.isFinite(session.amount_total) ? session.amount_total : null,
    currency: session.currency || 'usd',
    purchased_at: new Date().toISOString(),
  };
  const { error } = await sb()
    .from('property_entitlements')
    .upsert(entitlement, { onConflict: 'user_id,site_id' });
  if (error) {
    // Migration 021 creates this durable table. Until it is applied, the
    // verified subscription_events record remains the compatibility fallback.
    if (error.code === '42P01' || /property_entitlements/i.test(error.message || '')) {
      console.warn('[stripe] property_entitlements migration is not applied; using billing-event fallback');
      return false;
    }
    throw error;
  }
  return true;
}

async function syncSubscription(subscription, fallbackUserId = null) {
  if (!subscription?.id) return { fulfilled: false, status: 'missing_subscription' };
  let userId = subscription.metadata?.user_id || fallbackUserId;
  if (!userId && subscription.customer) {
    const customerId = typeof subscription.customer === 'string' ? subscription.customer : subscription.customer.id;
    const { data: profile, error } = await sb()
      .from('profiles').select('id').eq('stripe_customer_id', customerId).maybeSingle();
    if (error) throw error;
    userId = profile?.id || null;
  }
  if (!userId) return { fulfilled: false, status: 'missing_user' };

  const status = subscription.status || 'incomplete';
  const active = ACTIVE_SUBSCRIPTION_STATUSES.has(status);
  const { error } = await sb().from('profiles')
    .update(subscriptionProfilePatch(status, subscription.id))
    .eq('id', userId);
  if (error) throw error;
  return { fulfilled: active, status };
}

async function fulfillCheckoutSession(session) {
  const metadata = session?.metadata || {};
  const userId = metadata.user_id;
  const purchaseKind = metadata.purchase_kind || metadata.kind;
  if (!userId) return { fulfilled: false, status: 'missing_user' };

  if (purchaseKind === 'property') {
    const paid = String(session.payment_status || '').toLowerCase() === 'paid';
    if (paid && metadata.site_id) await persistPropertyEntitlement(session);
    return {
      fulfilled: paid,
      status: paid ? 'unlocked' : 'payment_pending',
      siteId: String(metadata.site_id || ''),
    };
  }

  if (purchaseKind === 'subscription' || metadata.plan === 'pro') {
    const subscription = typeof session.subscription === 'string'
      ? await stripe().subscriptions.retrieve(session.subscription)
      : session.subscription;
    return syncSubscription(subscription, userId);
  }

  return { fulfilled: false, status: 'unknown_purchase' };
}

// GET /api/stripe/plans
router.get('/plans', (req, res) => {
  res.json(Object.entries(PLANS).map(([key, plan]) => ({ key, ...plan })));
});

// GET /api/stripe/status — safe production readiness details (never returns keys)
router.get('/status', (req, res) => {
  const config = billingConfiguration();
  res.json({
    ...config,
    ready: config.checkoutConfigured && config.webhookConfigured,
    paymentMethods: CHECKOUT_PAYMENT_METHODS,
    offers: { property: PLANS.property.price, proMonthly: PLANS.pro.price },
  });
});

// POST /api/stripe/checkout — create Stripe checkout session
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    if (!requireCheckoutConfigured(res)) return;
    if (!await hasAcceptedCurrentTerms(req.user.id)) {
      return res.status(428).json({ error: 'Accept the current Terms and underwriting-risk disclosure before checkout.' });
    }
    const purchaseKind = req.body?.kind === 'property' ? 'property' : 'subscription';
    const siteId = purchaseKind === 'property' ? String(req.body?.siteId || '').trim() : '';
    if (purchaseKind === 'property' && !siteId) {
      return res.status(400).json({ error: 'A property is required for a single-property unlock.' });
    }
    if (purchaseKind === 'property') {
      if (!await billableSiteExists(siteId)) {
        return res.status(404).json({ error: 'The selected property is no longer available.' });
      }
      const unlocked = await getUnlockedSiteIdsFast(req.user.id);
      if (unlocked.includes(siteId)) {
        return res.status(409).json({ error: 'This property is already unlocked.' });
      }
    } else {
      const { data: profile } = await sb()
        .from('profiles').select('plan,subscription_status').eq('id', req.user.id).maybeSingle();
      if (['pro', 'enterprise'].includes(profile?.plan) && ['active', 'trialing'].includes(profile?.subscription_status)) {
        return res.status(409).json({ error: 'Unlimited access is already active for this account.' });
      }
    }

    const customerId = await customerForUser(req.user);
    const metadata = {
      user_id: req.user.id,
      purchase_kind: purchaseKind,
      plan: purchaseKind === 'subscription' ? 'pro' : 'property',
      ...(siteId ? { site_id: siteId } : {}),
    };
    const offer = purchaseKind === 'property' ? PLANS.property : PLANS.pro;
    const configuredPrice = purchaseKind === 'property'
      ? process.env.STRIPE_PROPERTY_PRICE_ID
      : process.env.STRIPE_PRO_PRICE_ID;
    const lineItem = configuredPrice ? { price: configuredPrice, quantity: 1 } : {
      price_data: {
        currency: 'usd',
        unit_amount: Math.round(offer.price * 100),
        product_data: {
          name: purchaseKind === 'property' ? 'ParcelLA Single Property Unlock' : 'ParcelLA Unlimited',
          description: purchaseKind === 'property'
            ? 'Permanent full-data access for one selected property.'
            : 'Unlimited full-data access to ParcelLA properties.',
        },
        ...(purchaseKind === 'subscription' ? { recurring: { interval: 'month' } } : {}),
      },
      quantity: 1,
    };
    const successParams = new URLSearchParams({
      checkout: 'success',
      session_id: '{CHECKOUT_SESSION_ID}',
      ...(siteId ? { site: siteId } : {}),
    });
    const successQuery = successParams.toString().replace('%7BCHECKOUT_SESSION_ID%7D', '{CHECKOUT_SESSION_ID}');
    const returnUrl = returnUrlForRequest(req);
    const requestKey = String(req.get('x-idempotency-key') || randomUUID()).replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
    const session = await stripe().checkout.sessions.create({
      customer: customerId,
      client_reference_id: req.user.id,
      payment_method_types: CHECKOUT_PAYMENT_METHODS,
      line_items: [lineItem],
      mode: purchaseKind === 'property' ? 'payment' : 'subscription',
      success_url: `${returnUrl}/?${successQuery}`,
      cancel_url: `${returnUrl}/?checkout=cancelled${siteId ? `&site=${encodeURIComponent(siteId)}` : ''}`,
      metadata,
      allow_promotion_codes: true,
      ...(purchaseKind === 'property'
        ? {
          invoice_creation: { enabled: true },
          payment_intent_data: { metadata },
        }
        : { subscription_data: { metadata } }),
    }, { idempotencyKey: `parcella-checkout-${req.user.id}-${requestKey}` });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) { next(err); }
});

// GET /api/stripe/checkout-session/:sessionId — verify a return from hosted Checkout
router.get('/checkout-session/:sessionId', requireAuth, async (req, res, next) => {
  try {
    if (!requireCheckoutConfigured(res)) return;
    const session = await stripe().checkout.sessions.retrieve(req.params.sessionId, {
      expand: ['subscription'],
    });
    if (session.metadata?.user_id !== req.user.id) {
      return res.status(403).json({ error: 'This checkout belongs to another account.' });
    }

    const result = await fulfillCheckoutSession(session);
    await recordBillingEvent({
      id: `checkout_session_verified_${session.id}`,
      type: 'checkout.session.verified',
      data: { object: session },
    }, req.user.id);
    res.json({
      ...result,
      paymentStatus: session.payment_status,
      purchaseKind: session.metadata?.purchase_kind,
      siteId: session.metadata?.site_id || null,
    });
  } catch (err) { next(err); }
});

// POST /api/stripe/portal — customer billing portal
router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    if (!requireCheckoutConfigured(res)) return;
    const { data: profile } = await sb()
      .from('profiles').select('stripe_customer_id').eq('id', req.user.id).single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found — subscribe first' });
    }

    const session = await stripe().billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: `${returnUrlForRequest(req)}/`,
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// POST /api/stripe/webhook — handle Stripe events
// Note: must use express.raw() for this route (Stripe signature verification)
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!secret || !billingConfiguration().checkoutConfigured) {
    return res.status(503).json({ error: 'Stripe webhook is not configured.' });
  }

  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[stripe] Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[stripe] Event: ${event.type}`);

  try {
    const eventUserId = event.data.object?.metadata?.user_id || null;
    await recordBillingEvent(event, eventUserId);

    switch (event.type) {
      case 'checkout.session.completed': {
        await fulfillCheckoutSession(event.data.object);
        break;
      }
      case 'checkout.session.async_payment_succeeded': {
        await fulfillCheckoutSession(event.data.object);
        break;
      }
      case 'checkout.session.async_payment_failed':
        console.warn('[stripe] Delayed payment failed:', event.data.object.id);
        break;
      case 'customer.subscription.created':
      case 'customer.subscription.updated': {
        await syncSubscription(event.data.object);
        break;
      }
      case 'customer.subscription.deleted': {
        await syncSubscription({ ...event.data.object, status: 'canceled' });
        break;
      }
    }

  } catch (err) {
    console.error('[stripe] Webhook handler error:', err.message);
    return res.status(500).json({ error: 'Webhook processing failed' });
  }

  res.json({ received: true });
});

// Middleware: check plan limits
export function requirePlan(minPlan) {
  const PLAN_ORDER = ['free', 'pro', 'enterprise'];
  return async (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Authentication required' });
    const { data: profile } = await sb()
      .from('profiles').select('plan, subscription_status').eq('id', req.user.id).maybeSingle();
    const userPlan = profile?.plan ?? 'free';
    const userIdx  = PLAN_ORDER.indexOf(userPlan);
    const reqIdx   = PLAN_ORDER.indexOf(minPlan);
    const subscriptionActive = userPlan === 'enterprise' || ACTIVE_SUBSCRIPTION_STATUSES.has(profile?.subscription_status);
    if (userIdx < reqIdx || (minPlan === 'pro' && !subscriptionActive)) {
      return res.status(403).json({
        error:    `${minPlan} plan required`,
        upgrade:  'https://parcel-la.vercel.app/#pricing',
        yourPlan: userPlan,
      });
    }
    req.plan   = userPlan;
    req.limits = PLANS[userPlan]?.limits ?? PLANS.free.limits;
    next();
  };
}

export default router;
