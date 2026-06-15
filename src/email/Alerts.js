/**
 * ParceLLA — Email Alert System
 *
 * Sends deal alerts when new sites match a user's saved filters.
 * Also handles:
 *   - Welcome email on signup
 *   - Deal memo email (PDF attachment)
 *   - Weekly digest of top deals
 *
 * Provider: Resend (resend.com) — simpler than SendGrid, $0 for 3K/mo
 * Fallback:  SendGrid (sendgrid.com) — $0 for 100/day
 *
 * Setup:
 *   npm install resend
 *   RESEND_API_KEY=re_xxxx in .env
 */

import { createClient } from '@supabase/supabase-js';

const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

// ── Email client (Resend) ─────────────────────────────────────────────────────
async function sendEmail({ to, subject, html, attachments = [] }) {
  if (!process.env.RESEND_API_KEY) {
    console.warn('[email] RESEND_API_KEY not set — skipping email send');
    console.log(`[email] Would send to: ${to} | Subject: ${subject}`);
    return { id: 'mock', skipped: true };
  }

  const body = { from: 'ParceLLA <deals@parcella.com>', to, subject, html };
  if (attachments.length) body.attachments = attachments;

  const res = await fetch('https://api.resend.com/emails', {
    method:  'POST',
    headers: { 'Authorization': `Bearer ${process.env.RESEND_API_KEY}`,
               'Content-Type': 'application/json' },
    body:    JSON.stringify(body),
  });

  if (!res.ok) {
    const err = await res.json();
    throw new Error(`Resend error: ${err.message}`);
  }
  return res.json();
}

// ── Email templates ────────────────────────────────────────────────────────────
const BRAND = {
  navy:  '#0f1f3d',
  gold:  '#c49a3c',
  green: '#1d9e75',
  amber: '#ef9f27',
  red:   '#e24b4a',
};

function baseTemplate(content) {
  return `<!DOCTYPE html>
<html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<style>
  body { font-family: Arial, Helvetica, sans-serif; background: #f5f5f5; margin: 0; padding: 20px; }
  .wrap { max-width: 580px; margin: 0 auto; background: #fff; border-radius: 8px; overflow: hidden; }
  .hdr { background: ${BRAND.navy}; padding: 20px 28px; }
  .logo { font-size: 20px; font-weight: 700; color: #fff; letter-spacing: -0.5px; }
  .logo span { color: ${BRAND.gold}; }
  .body { padding: 24px 28px; }
  .footer { background: #f5f5f5; padding: 14px 28px; font-size: 11px; color: #999; }
  h2 { color: ${BRAND.navy}; font-size: 18px; margin: 0 0 8px; }
  p { color: #444; font-size: 14px; line-height: 1.6; margin: 0 0 12px; }
  .btn { display: inline-block; background: ${BRAND.navy}; color: #fff; padding: 10px 20px;
         border-radius: 6px; text-decoration: none; font-size: 13px; font-weight: 600; margin: 8px 0; }
  .metric-row { display: flex; gap: 8px; margin: 12px 0; flex-wrap: wrap; }
  .metric { background: #f8f8f8; border-radius: 6px; padding: 10px 14px; flex: 1; min-width: 100px; }
  .metric-label { font-size: 10px; color: #888; text-transform: uppercase; letter-spacing: 0.5px; margin-bottom: 3px; }
  .metric-val { font-size: 18px; font-weight: 700; color: ${BRAND.navy}; }
  .site-card { border: 1px solid #eee; border-radius: 8px; padding: 14px 16px; margin-bottom: 12px; }
  .site-addr { font-size: 15px; font-weight: 700; color: ${BRAND.navy}; margin-bottom: 3px; }
  .site-meta { font-size: 12px; color: #888; margin-bottom: 10px; }
  .irr-good { color: ${BRAND.green}; } .irr-ok { color: ${BRAND.amber}; } .irr-bad { color: ${BRAND.red}; }
  .divider { border: none; border-top: 1px solid #eee; margin: 16px 0; }
</style></head><body>
<div class="wrap">
  <div class="hdr"><div class="logo">PARCEL<span>LA</span></div></div>
  <div class="body">${content}</div>
  <div class="footer">
    ParceLLA · Los Angeles Development Site Marketplace · parcella.com<br>
    <a href="{{unsubscribe_url}}" style="color:#999">Unsubscribe</a> · 
    <a href="https://parcella.com/privacy" style="color:#999">Privacy</a>
  </div>
</div>
</body></html>`;
}

function fmtM(n) {
  return n >= 1e6 ? '$' + (Math.round(n/1e5)/10) + 'M'
       : n >= 1e3 ? '$' + Math.round(n/1e3) + 'K'
       : '$' + Math.round(n);
}

function irrClass(v) {
  return v >= 18 ? 'irr-good' : v >= 12 ? 'irr-ok' : 'irr-bad';
}

// ── Welcome email ─────────────────────────────────────────────────────────────
export async function sendWelcomeEmail(user) {
  const html = baseTemplate(`
    <h2>Welcome to ParceLLA 👋</h2>
    <p>You now have access to the only LA development site marketplace that pre-underwrites every deal for you — IRR, net profit, cap rate on cost, and development spread calculated automatically.</p>
    <p><strong>Here's what you can do:</strong></p>
    <ul style="color:#444;font-size:14px;line-height:2">
      <li>Search 27+ LA development sites filtered by calculated returns</li>
      <li>Set deal alerts — get notified when new sites hit your IRR threshold</li>
      <li>Export one-click PDF deal memos for any site</li>
      <li>Save sites and custom model assumptions to your account</li>
    </ul>
    <a href="https://parcella.com" class="btn">Open ParceLLA →</a>
    <hr class="divider">
    <p style="font-size:12px;color:#888">Questions? Reply to this email — we read everything.</p>
  `);

  return sendEmail({ to: user.email, subject: 'Welcome to ParceLLA', html });
}

// ── Deal alert email ──────────────────────────────────────────────────────────
export async function sendDealAlertEmail(user, alert, matchingSites) {
  if (!matchingSites.length) return;

  const siteCards = matchingSites.slice(0, 5).map(s => {
    const m = s._m ?? s;
    const irrCls = irrClass(m.irrV ?? m.irr);
    return `
    <div class="site-card">
      <div class="site-addr">${s.addr ?? s.address}</div>
      <div class="site-meta">${s.hood} · ${s.zone} · ${s.units} units · ${s.rti ? '✓ RTI' : 'For Sale'}</div>
      <div class="metric-row">
        <div class="metric"><div class="metric-label">Net profit</div>
          <div class="metric-val">${fmtM(m.netProfit)}</div></div>
        <div class="metric"><div class="metric-label">IRR</div>
          <div class="metric-val ${irrCls}">${m.irrV ?? m.irr}%</div></div>
        <div class="metric"><div class="metric-label">Cap on cost</div>
          <div class="metric-val">${m.capOnCost}%</div></div>
      </div>
      <a href="https://parcella.com/deal?site=${s.id}" class="btn" style="font-size:11px;padding:6px 14px">View deal →</a>
    </div>`;
  }).join('');

  const html = baseTemplate(`
    <h2>🔔 ${matchingSites.length} new site${matchingSites.length > 1 ? 's' : ''} match "${alert.name}"</h2>
    <p>New development sites were added that match your saved alert criteria.</p>
    ${siteCards}
    ${matchingSites.length > 5 ? `<p style="text-align:center;font-size:13px;color:#888">+${matchingSites.length - 5} more sites matching this alert</p>` : ''}
    <a href="https://parcella.com" class="btn">View all matching sites →</a>
    <hr class="divider">
    <p style="font-size:11px;color:#888">Alert: "${alert.name}" · Frequency: ${alert.frequency} · 
      <a href="https://parcella.com/alerts" style="color:#888">Manage alerts</a></p>
  `);

  return sendEmail({
    to:      user.email,
    subject: `[ParceLLA Alert] ${matchingSites.length} new site${matchingSites.length > 1 ? 's' : ''} — "${alert.name}"`,
    html,
  });
}

// ── Weekly digest ─────────────────────────────────────────────────────────────
export async function sendWeeklyDigest(user, topSites) {
  const siteCards = topSites.slice(0, 6).map(s => {
    const m = s._m ?? s;
    return `
    <div class="site-card">
      <div class="site-addr">${s.addr}</div>
      <div class="site-meta">${s.hood} · ${s.type} · ${s.units} units</div>
      <div class="metric-row">
        <div class="metric"><div class="metric-label">IRR</div>
          <div class="metric-val ${irrClass(m.irrV)}">${m.irrV}%</div></div>
        <div class="metric"><div class="metric-label">Net profit</div>
          <div class="metric-val">${fmtM(m.netProfit)}</div></div>
        <div class="metric"><div class="metric-label">All-in</div>
          <div class="metric-val">${fmtM(m.total)}</div></div>
      </div>
      <a href="https://parcella.com/deal?site=${s.id}" style="font-size:11px;color:${BRAND.navy}">View deal →</a>
    </div>`;
  }).join('');

  const html = baseTemplate(`
    <h2>📊 Your weekly LA development market update</h2>
    <p>Top deals in the ParceLLA marketplace this week, ranked by net profit:</p>
    ${siteCards}
    <a href="https://parcella.com" class="btn">Browse all sites →</a>
  `);

  return sendEmail({
    to:      user.email,
    subject: `ParceLLA Weekly: Top LA dev sites — ${new Date().toLocaleDateString('en-US', { month: 'short', day: 'numeric' })}`,
    html,
  });
}

// ── Deal memo email (with PDF attachment) ─────────────────────────────────────
export async function sendDealMemoEmail({ to, site, model, pdfBuffer }) {
  const html = baseTemplate(`
    <h2>Deal memo: ${site.addr}</h2>
    <p>Your ParceLLA deal analysis is attached.</p>
    <div class="metric-row">
      <div class="metric"><div class="metric-label">Net profit</div>
        <div class="metric-val">${fmtM(model.netProfit)}</div></div>
      <div class="metric"><div class="metric-label">IRR</div>
        <div class="metric-val ${irrClass(model.irrV)}">${model.irrV}%</div></div>
      <div class="metric"><div class="metric-label">All-in cost</div>
        <div class="metric-val">${fmtM(model.total)}</div></div>
    </div>
    <a href="https://parcella.com/deal?site=${site.id}" class="btn">View online →</a>
    <p style="font-size:11px;color:#888;margin-top:12px">
      Assumptions: RSMeans 2024 hard costs · Prop 13 property tax · ${(model.exitCap*100).toFixed(2)}% exit cap
    </p>
  `);

  const attachments = pdfBuffer ? [{
    filename: `ParceLLA_${site.addr.replace(/\s+/g,'_')}.pdf`,
    content:  pdfBuffer.toString('base64'),
  }] : [];

  return sendEmail({
    to,
    subject: `ParceLLA Deal Memo: ${site.addr} — ${model.irrV}% IRR`,
    html,
    attachments,
  });
}

// ── Alert runner — called by nightly sync job ─────────────────────────────────
export async function runAlerts(newSites, allSites) {
  if (!newSites.length) return;

  const { data: alerts } = await sb
    .from('alerts')
    .select('*, profiles(email, name)')
    .eq('active', true);

  if (!alerts?.length) return;

  for (const alert of alerts) {
    const f = alert.filters ?? {};
    const matching = newSites.filter(s => {
      const m = s._m ?? {};
      return (
        (!f.hood     || f.hood  === s.hood)   &&
        (!f.type     || f.type  === s.type)   &&
        (!f.zone     || f.zone  === s.zone)   &&
        (!f.rti      || s.rti)                &&
        (!f.minUnits || s.units >= f.minUnits) &&
        (!f.minIRR   || (m.irrV ?? 0) >= f.minIRR) &&
        (!f.minProfit|| (m.netProfit ?? 0) >= f.minProfit)
      );
    });

    if (!matching.length) continue;

    const user = { email: alert.profiles?.email, name: alert.profiles?.name };
    if (!user.email) continue;

    await sendDealAlertEmail(user, alert, matching);
    await sb.from('alerts').update({ last_run: new Date().toISOString() }).eq('id', alert.id);
    console.log(`[alerts] Sent alert "${alert.name}" to ${user.email} — ${matching.length} sites`);
  }
}

// ── Express route: POST /api/email/deal-memo ──────────────────────────────────
export async function emailDealMemoRoute(req, res, next) {
  try {
    const { to, siteId, overrides = {} } = req.body;
    if (!to || !siteId) return res.status(400).json({ error: 'to and siteId required' });

    const { SITES }    = await import('../data/sites.js');
    const { runModel } = await import('../model/financialModel.js');
    const site  = SITES.find(s => s.id === siteId);
    if (!site)  return res.status(404).json({ error: 'Site not found' });

    const model = runModel(site, overrides);

    // Generate PDF
    let pdfBuffer = null;
    try {
      const { generateDealMemo } = await import('../pdf/DealMemo.js');
      pdfBuffer = await generateDealMemo({ ...site, ...model });
    } catch (e) {
      console.warn('[email] PDF generation failed:', e.message);
    }

    await sendDealMemoEmail({ to, site, model, pdfBuffer });
    res.json({ sent: true, to });
  } catch (err) { next(err); }
}
