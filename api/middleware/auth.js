/**
 * ParceLLA — Auth Middleware
 * Verifies Supabase JWT on protected routes.
 */

import { createClient } from '@supabase/supabase-js';

const supabase = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY   // service key for server-side verification
);

const FREE_ACCESS_HOURS = 24;
const ACTIVE_SUBSCRIPTION_STATUSES = new Set(['active', 'trialing']);
const AUTH_LOOKUP_TIMEOUT_MS = Number(process.env.AUTH_LOOKUP_TIMEOUT_MS || 2500);
const DEFAULT_ALWAYS_ACCESS_EMAILS = [
  'ssamuel@goodhealthcorp.com',
  'kambizkamdar@gmail.com',
];
const ALWAYS_ACCESS_EMAILS = new Set([
  ...DEFAULT_ALWAYS_ACCESS_EMAILS,
  ...String(process.env.ALWAYS_ACCESS_EMAILS || '')
    .split(',')
    .map(email => email.trim().toLowerCase())
    .filter(Boolean),
]);

function timeoutAfter(ms, value) {
  return new Promise(resolve => setTimeout(() => resolve(value), ms));
}

async function withAuthTimeout(promise, fallback, timeoutMs = AUTH_LOOKUP_TIMEOUT_MS) {
  return Promise.race([promise, timeoutAfter(timeoutMs, fallback)]);
}

function trialEndIso() {
  return new Date(Date.now() + FREE_ACCESS_HOURS * 60 * 60 * 1000).toISOString();
}

function expiresInSeconds(value) {
  if (!value) return 0;
  const ms = new Date(value).getTime() - Date.now();
  return Number.isFinite(ms) ? Math.max(0, Math.floor(ms / 1000)) : 0;
}

function emailKey(value) {
  return String(value || '').trim().toLowerCase();
}

function hasAlwaysAccess(email) {
  return ALWAYS_ACCESS_EMAILS.has(emailKey(email));
}

function alwaysAccess(email) {
  return {
    active: true,
    plan: 'enterprise',
    subscriptionStatus: 'active',
    trialEndsAt: null,
    trialSecondsRemaining: 0,
    freeAccessHours: FREE_ACCESS_HOURS,
    reason: 'owner_allowlist',
    email: emailKey(email),
  };
}

export function accessForProfile(profile = null) {
  if (hasAlwaysAccess(profile?.email)) return alwaysAccess(profile.email);

  const plan = profile?.plan || 'free';
  const subscriptionStatus = profile?.subscription_status || 'inactive';
  const paidAccess = ['pro', 'enterprise'].includes(plan) && ACTIVE_SUBSCRIPTION_STATUSES.has(subscriptionStatus);
  const trialSecondsRemaining = expiresInSeconds(profile?.trial_ends_at);
  const trialAccess = plan === 'free' && trialSecondsRemaining > 0;
  const active = paidAccess || trialAccess;

  return {
    active,
    plan,
    subscriptionStatus,
    trialEndsAt: profile?.trial_ends_at || null,
    trialSecondsRemaining,
    freeAccessHours: FREE_ACCESS_HOURS,
    reason: paidAccess ? 'subscription' : trialAccess ? 'free_24h_trial' : 'locked',
  };
}

export async function ensureUserProfile(user) {
  if (!user) return null;

  const { data: existing, error: selectError } = await supabase
    .from('profiles')
    .select('*')
    .eq('id', user.id)
    .maybeSingle();

  if (selectError) throw selectError;

  const patch = {
    email: user.email,
    name: user.user_metadata?.name || user.user_metadata?.full_name || existing?.name || null,
  };

  if (!existing) {
    const { data, error } = await supabase
      .from('profiles')
      .insert({
        id: user.id,
        ...patch,
        plan: 'free',
        subscription_status: 'trialing',
        trial_ends_at: trialEndIso(),
      })
      .select('*')
      .single();
    if (error) throw error;
    return data;
  }

  if (!existing.trial_ends_at && (existing.plan || 'free') === 'free') {
    patch.subscription_status = existing.subscription_status || 'trialing';
    patch.trial_ends_at = trialEndIso();
  }

  const { data, error } = await supabase
    .from('profiles')
    .update(patch)
    .eq('id', user.id)
    .select('*')
    .single();

  if (error) throw error;
  return data;
}

export async function getUserAccess(user) {
  if (!user) return accessForProfile(null);
  if (hasAlwaysAccess(user.email)) return alwaysAccess(user.email);
  const profile = await ensureUserProfile(user);
  return accessForProfile(profile);
}

export async function getUserAccessFast(user, timeoutMs = AUTH_LOOKUP_TIMEOUT_MS) {
  if (!user) return accessForProfile(null);
  if (hasAlwaysAccess(user.email)) return alwaysAccess(user.email);

  try {
    const profile = await withAuthTimeout(ensureUserProfile(user), undefined, timeoutMs);
    if (profile === undefined) return accessForProfile(null);
    return accessForProfile(profile);
  } catch (err) {
    console.warn('[auth] Access profile lookup failed; returning locked access:', err.message);
    return accessForProfile(null);
  }
}

/**
 * requireAuth — hard gate, returns 401 if no valid session
 */
export async function requireAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Missing authorization header' });
  }

  const token = authHeader.slice(7);
  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    return res.status(401).json({ error: 'Invalid or expired token' });
  }

  req.user = user;
  next();
}

export async function requireActiveAccess(req, res, next) {
  try {
    const access = await getUserAccess(req.user);
    if (!access.active) {
      return res.status(402).json({
        error: 'A free account or active subscription is required to view full deal details.',
        access,
        upgrade: '/api/stripe/checkout',
      });
    }
    req.access = access;
    next();
  } catch (err) {
    next(err);
  }
}

/**
 * optionalAuth — sets req.user if token present, but doesn't block
 */
export async function optionalAuth(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader?.startsWith('Bearer ')) return next();

  try {
    const token = authHeader.slice(7);
    const result = await withAuthTimeout(supabase.auth.getUser(token), null);
    const user = result?.data?.user;
    if (user) req.user = user;
  } catch (err) {
    console.warn('[auth] Optional auth lookup failed; continuing anonymously:', err.message);
  }
  next();
}
