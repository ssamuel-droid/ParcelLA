/**
 * ParceLLA — Narrative + Share routers
 * POST /api/narrative/:siteId  — generate AI deal memo
 * POST /api/share              — create share token
 * GET  /api/share/:token       — resolve share token
 * GET  /api/activity           — user activity log
 * POST /api/auth/forgot-password
 * GET  /api/email/deal-memo    — send deal memo via email
 */

import { Router }      from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth, optionalAuth }  from '../middleware/auth.js';
import { SITES, normalizeSite } from '../../src/data/sites.js';
import { runModel }    from '../../src/model/financialModel.js';

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// ── NARRATIVE ─────────────────────────────────────────────────────────────────
export const narrativeRouter = Router();

narrativeRouter.post('/:siteId', optionalAuth, async (req, res, next) => {
  try {
    const siteId = +req.params.siteId;
    const site   = SITES.find(s => s.id === siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const { overrides = {} } = req.body;
    const model = runModel(normalizeSite(site), overrides);

    // Hash model assumptions for cache key
    const hash = `${model.land}|${model.hcpsf}|${model.exitCap}|${overrides.sc ?? 18}`;
    const hashKey = hash.split('').reduce((h,c) => ((h*31)+c.charCodeAt(0))&0xffffffff,0).toString(16);

    // Check cache
    const { data: cached } = await sb()
      .from('narratives').select('narrative')
      .match({ site_id: siteId, model_hash: hashKey }).maybeSingle();

    if (cached) {
      await logActivity(req.user?.id, 'view_narrative', siteId);
      return res.json({ narrative: cached.narrative, cached: true });
    }

    // Generate via Claude
    const fmtM = n => n >= 1e6 ? '$' + (Math.round(n/1e5)/10) + 'M'
                    : n >= 1e3 ? '$' + Math.round(n/1e3) + 'K'
                    : '$' + Math.round(n);

    const prompt = `You are a senior real estate development analyst at a top-tier LA investment firm. Write a concise, plain-English deal assessment.

SITE: ${site.addr}, ${site.hood} · ${site.type} · ${site.units} units · ${site.rti ? 'RTI Approved' : site.isComp ? 'Off-market comp' : 'For sale'}
LAND: ${fmtM(model.land)}${site.isComp ? ' (imputed)' : ''} · ALL-IN: ${fmtM(model.total)} (${fmtM(Math.round(model.total/site.units))}/unit)
HARD COSTS: ${fmtM(model.hard)} ($${model.hcpsf}/SF RSMeans 2024) · SOFT: ${fmtM(model.soft)} · CARRY: ${fmtM(model.carry)}
NOI: ${fmtM(model.noi)} · ENTRY CAP: ${(model.entryCap*100).toFixed(2)}% · EXIT CAP: ${(model.exitCap*100).toFixed(2)}%
EXIT VALUE: ${fmtM(model.exitValue)} · NET PROFIT: ${fmtM(model.netProfit)} · IRR: ${model.irrV}%
CAP ON COST: ${model.capOnCost}% · DEV SPREAD: ${model.devSpreadPct}% · EQUITY MULTIPLE: ${model.eqMult}x

Write exactly 3 paragraphs, max 200 words total:
1. Why this deal does or doesn't pencil — what's specifically driving the return number
2. The single most important risk a sophisticated LP or lender would raise
3. One non-obvious insight a less experienced buyer would likely miss

Be direct, specific with numbers, opinionated. No hedging language. No bullet points. No preamble.`;

    const r = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'anthropic-version': '2023-06-01',
        'x-api-key': process.env.ANTHROPIC_API_KEY ?? '',
      },
      body: JSON.stringify({
        model:      'claude-sonnet-4-6',
        max_tokens:  450,
        messages:   [{ role: 'user', content: prompt }],
      }),
    });

    if (!r.ok) {
      const err = await r.json().catch(() => ({}));
      throw new Error(err.error?.message ?? `Claude API ${r.status}`);
    }

    const data      = await r.json();
    const narrative = data.content?.[0]?.text ?? '';
    const tokens    = data.usage?.input_tokens + data.usage?.output_tokens;

    // Cache it
    await sb().from('narratives').upsert({
      site_id: siteId, model_hash: hashKey, narrative, tokens_used: tokens,
    });

    await logActivity(req.user?.id, 'generate_narrative', siteId, { tokens });
    res.json({ narrative, cached: false, tokens });
  } catch (err) { next(err); }
});

// ── SHARE LINKS ───────────────────────────────────────────────────────────────
export const shareRouter = Router();

shareRouter.post('/', optionalAuth, async (req, res, next) => {
  try {
    const {
      siteId, overrides = {}, preset = 'institutional',
      expiresInDays = 30, label = '',
    } = req.body;

    if (!siteId) return res.status(400).json({ error: 'siteId required' });

    const chars  = 'abcdefghijklmnopqrstuvwxyz0123456789';
    const token  = Array.from({ length: 10 }, () => chars[Math.floor(Math.random() * chars.length)]).join('');
    const expiry = new Date(Date.now() + expiresInDays * 86400000).toISOString();

    const { data, error } = await sb().from('share_links').insert({
      token, site_id: siteId, overrides, preset, label,
      created_by: req.user?.id ?? null,
      expires_at: expiry,
    }).select().single();

    if (error) throw error;

    const APP_URL = process.env.APP_URL ?? 'https://parcella.com';
    await logActivity(req.user?.id, 'create_share_link', siteId, { token });
    res.json({ token, url: `${APP_URL}/deal/${token}`, expiresAt: expiry });
  } catch (err) { next(err); }
});

shareRouter.get('/:token', async (req, res, next) => {
  try {
    const { data, error } = await sb()
      .from('share_links')
      .select('*, sites(*)')
      .eq('token', req.params.token)
      .gt('expires_at', new Date().toISOString())
      .single();

    if (error || !data) return res.status(404).json({ error: 'Share link not found or expired' });

    // Increment view count
    await sb().from('share_links')
      .update({ view_count: (data.view_count ?? 0) + 1 })
      .eq('token', req.params.token);

    res.json({ site: data.sites, overrides: data.overrides, preset: data.preset, label: data.label });
  } catch (err) { next(err); }
});

// ── ACTIVITY LOG ──────────────────────────────────────────────────────────────
export const activityRouter = Router();

activityRouter.get('/', requireAuth, async (req, res, next) => {
  try {
    const { limit = 50, offset = 0 } = req.query;
    const { data, error } = await sb()
      .from('activity_log')
      .select('*, sites(address, neighborhood)')
      .eq('user_id', req.user.id)
      .order('created_at', { ascending: false })
      .range(+offset, +offset + +limit - 1);

    if (error) throw error;
    res.json(data ?? []);
  } catch (err) { next(err); }
});

// Helper used by other routes
export async function logActivity(userId, action, siteId = null, metadata = {}) {
  if (!userId) return;
  try {
    await sb().from('activity_log').insert({
      user_id: userId, action, site_id: siteId, metadata,
    });
  } catch { /* non-fatal */ }
}

// ── FORGOT PASSWORD ───────────────────────────────────────────────────────────
export const passwordRouter = Router();

passwordRouter.post('/forgot-password', async (req, res, next) => {
  try {
    const { email } = req.body;
    if (!email) return res.status(400).json({ error: 'Email required' });

    const APP_URL  = process.env.APP_URL ?? 'https://parcella.com';
    const anonSb   = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { error } = await anonSb.auth.resetPasswordForEmail(email, {
      redirectTo: `${APP_URL}/reset-password`,
    });

    if (error) throw error;
    // Always return success to prevent email enumeration
    res.json({ message: 'If that email exists, a reset link has been sent.' });
  } catch (err) { next(err); }
});

passwordRouter.post('/reset-password', async (req, res, next) => {
  try {
    const { password, access_token } = req.body;
    if (!password || !access_token) {
      return res.status(400).json({ error: 'password and access_token required' });
    }

    const anonSb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
    const { error: sessionErr } = await anonSb.auth.setSession({ access_token, refresh_token: '' });
    if (sessionErr) return res.status(401).json({ error: 'Invalid or expired reset token' });

    const { error } = await anonSb.auth.updateUser({ password });
    if (error) throw error;
    res.json({ message: 'Password updated successfully' });
  } catch (err) { next(err); }
});

// ── EMAIL DEAL MEMO ───────────────────────────────────────────────────────────
export const emailRouter = Router();

emailRouter.post('/deal-memo', requireAuth, async (req, res, next) => {
  try {
    const { to, siteId, overrides = {} } = req.body;
    if (!to || !siteId) return res.status(400).json({ error: 'to and siteId required' });

    const site  = SITES.find(s => s.id === siteId);
    if (!site)  return res.status(404).json({ error: 'Site not found' });
    const model = runModel(normalizeSite(site), overrides);

    const { emailDealMemoRoute } = await import('../../src/email/Alerts.js');
    await emailDealMemoRoute(req, res, next);

    await logActivity(req.user.id, 'email_deal_memo', siteId, { to });
  } catch (err) { next(err); }
});
