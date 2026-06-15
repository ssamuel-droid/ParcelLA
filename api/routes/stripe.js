/**
 * ParceLLA — Stripe Subscriptions Router
 *
 * Plans:
 *   free        — 10 searches/day, no PDF, no alerts
 *   pro         — $49/mo — unlimited search, PDF, alerts, AI narrative
 *   enterprise  — $199/mo — team seats, API access, white-label
 *
 * Setup:
 *   npm install stripe
 *   STRIPE_SECRET_KEY=sk_live_xxx
 *   STRIPE_WEBHOOK_SECRET=whsec_xxx
 *   STRIPE_PRO_PRICE_ID=price_xxx
 *   STRIPE_ENTERPRISE_PRICE_ID=price_xxx
 *
 * Routes:
 *   POST /api/stripe/checkout     — create Stripe checkout session
 *   POST /api/stripe/portal       — customer portal (manage/cancel)
 *   POST /api/stripe/webhook      — Stripe webhook handler
 *   GET  /api/stripe/plans        — list available plans
 */

import { Router }      from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth }  from '../middleware/auth.js';

const router = Router();
function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// Lazy-load Stripe so server starts without the key
let _stripe = null;
function stripe() {
  if (!_stripe) {
    if (!process.env.STRIPE_SECRET_KEY) throw new Error('STRIPE_SECRET_KEY not set');
    const Stripe = require('stripe');
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: '2024-06-20' });
  }
  return _stripe;
}

const PLANS = {
  free: {
    name:        'Free',
    price:       0,
    features:    ['10 site views/day', '5 model calculations/day', 'Basic filters', 'Save up to 5 sites'],
    limits:      { sitesPerDay: 10, modelsPerDay: 5, pdf: false, alerts: 1, aiNarrative: false },
  },
  pro: {
    name:        'Pro',
    price:       49,
    priceId:     process.env.STRIPE_PRO_PRICE_ID,
    features:    ['Unlimited searches', 'PDF deal memos', 'Deal alerts', 'AI narratives', 'Excel export', 'Deal sharing'],
    limits:      { sitesPerDay: Infinity, modelsPerDay: Infinity, pdf: true, alerts: 20, aiNarrative: true },
  },
  enterprise: {
    name:        'Enterprise',
    price:       199,
    priceId:     process.env.STRIPE_ENTERPRISE_PRICE_ID,
    features:    ['Everything in Pro', 'Team seats (5)', 'API access', 'White-label', 'Priority support', 'Custom data feeds'],
    limits:      { sitesPerDay: Infinity, modelsPerDay: Infinity, pdf: true, alerts: 100, aiNarrative: true, api: true, teamSeats: 5 },
  },
};

// GET /api/stripe/plans
router.get('/plans', (req, res) => {
  res.json(Object.entries(PLANS).map(([key, plan]) => ({ key, ...plan })));
});

// POST /api/stripe/checkout — create Stripe checkout session
router.post('/checkout', requireAuth, async (req, res, next) => {
  try {
    const { plan = 'pro' } = req.body;
    if (!PLANS[plan]?.priceId) {
      return res.status(400).json({ error: `Invalid plan: ${plan}` });
    }

    const APP_URL = process.env.APP_URL ?? 'https://parcella.com';

    // Get or create Stripe customer
    const { data: profile } = await sb()
      .from('profiles').select('stripe_customer_id, email').eq('id', req.user.id).single();

    let customerId = profile?.stripe_customer_id;
    if (!customerId) {
      const customer = await stripe().customers.create({
        email:    req.user.email,
        metadata: { supabase_uid: req.user.id },
      });
      customerId = customer.id;
      await sb().from('profiles').update({ stripe_customer_id: customerId }).eq('id', req.user.id);
    }

    const session = await stripe().checkout.sessions.create({
      customer:             customerId,
      payment_method_types: ['card'],
      line_items: [{
        price:    PLANS[plan].priceId,
        quantity: 1,
      }],
      mode:               'subscription',
      success_url:        `${APP_URL}/?upgraded=true`,
      cancel_url:         `${APP_URL}/pricing`,
      metadata:           { user_id: req.user.id, plan },
      subscription_data:  { trial_period_days: 14 },
    });

    res.json({ url: session.url, sessionId: session.id });
  } catch (err) { next(err); }
});

// POST /api/stripe/portal — customer billing portal
router.post('/portal', requireAuth, async (req, res, next) => {
  try {
    const APP_URL = process.env.APP_URL ?? 'https://parcella.com';
    const { data: profile } = await sb()
      .from('profiles').select('stripe_customer_id').eq('id', req.user.id).single();

    if (!profile?.stripe_customer_id) {
      return res.status(400).json({ error: 'No Stripe customer found — subscribe first' });
    }

    const session = await stripe().billingPortal.sessions.create({
      customer:   profile.stripe_customer_id,
      return_url: `${APP_URL}/account`,
    });

    res.json({ url: session.url });
  } catch (err) { next(err); }
});

// POST /api/stripe/webhook — handle Stripe events
// Note: must use express.raw() for this route (Stripe signature verification)
router.post('/webhook', async (req, res) => {
  const sig    = req.headers['stripe-signature'];
  const secret = process.env.STRIPE_WEBHOOK_SECRET;

  let event;
  try {
    event = stripe().webhooks.constructEvent(req.body, sig, secret);
  } catch (err) {
    console.error('[stripe] Webhook signature failed:', err.message);
    return res.status(400).send(`Webhook Error: ${err.message}`);
  }

  console.log(`[stripe] Event: ${event.type}`);

  try {
    switch (event.type) {
      case 'checkout.session.completed': {
        const session  = event.data.object;
        const userId   = session.metadata?.user_id;
        const plan     = session.metadata?.plan ?? 'pro';
        if (userId) {
          await sb().from('profiles').update({
            plan,
            stripe_subscription_id: session.subscription,
            subscription_status:    'active',
          }).eq('id', userId);
        }
        break;
      }
      case 'customer.subscription.updated': {
        const sub    = event.data.object;
        const { data: profile } = await sb()
          .from('profiles').select('id').eq('stripe_customer_id', sub.customer).maybeSingle();
        if (profile) {
          await sb().from('profiles').update({
            subscription_status: sub.status,
          }).eq('id', profile.id);
        }
        break;
      }
      case 'customer.subscription.deleted': {
        const sub = event.data.object;
        const { data: profile } = await sb()
          .from('profiles').select('id').eq('stripe_customer_id', sub.customer).maybeSingle();
        if (profile) {
          await sb().from('profiles').update({
            plan:                'free',
            subscription_status: 'cancelled',
            stripe_subscription_id: null,
          }).eq('id', profile.id);
        }
        break;
      }
    }

    // Log event
    await sb().from('subscription_events').insert({
      stripe_event_id: event.id,
      event_type:      event.type,
      stripe_data:     event.data.object,
    }).onConflict('stripe_event_id').ignore();

  } catch (err) {
    console.error('[stripe] Webhook handler error:', err.message);
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
    if (userIdx < reqIdx) {
      return res.status(403).json({
        error:    `${minPlan} plan required`,
        upgrade:  'https://parcella.com/pricing',
        yourPlan: userPlan,
      });
    }
    req.plan   = userPlan;
    req.limits = PLANS[userPlan]?.limits ?? PLANS.free.limits;
    next();
  };
}

export default router;
