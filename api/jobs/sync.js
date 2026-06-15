/**
 * ParceLLA — Nightly LADBS Permit Sync Job
 *
 * Runs nightly via node-cron to:
 *   1. Pull recent permits from LA City Open Data (Socrata)
 *   2. Match to existing sites by address
 *   3. Update RTI status if permit shows approval
 *   4. Upsert into Supabase permits table
 *   5. Fire deal alerts for users watching affected sites
 *
 * Schedule: 2 AM PT daily
 * Trigger manually: node api/jobs/sync.js --run-now
 */

import cron       from 'node-cron';
import { createClient } from '@supabase/supabase-js';
import { fetchPermits, fetchRTIStatus } from '../src/data/laOpenData.js';
import { SITES } from '../src/data/sites.js';

const sb = createClient(
  process.env.SUPABASE_URL,
  process.env.SUPABASE_SERVICE_KEY
);

// ── Permit sync ───────────────────────────────────────────────────────────────
async function syncLADBSPermits() {
  console.log(`[sync] Starting LADBS permit sync — ${new Date().toISOString()}`);
  let synced = 0, errors = 0;

  try {
    // Pull last 200 permits ordered by most recent
    const permits = await fetchPermits({ limit: 200 });
    console.log(`[sync] Fetched ${permits.length} permits from LADBS`);

    for (const permit of permits) {
      try {
        const isRTI = permit.status?.toLowerCase().includes('ready to issue') ||
                      permit.status?.toLowerCase().includes('rti') ||
                      permit.status?.toLowerCase().includes('approved for permit');

        // Try to match to a site
        const matchedSite = SITES.find(s =>
          s.addr && permit.address &&
          normalizeAddr(s.addr) === normalizeAddr(permit.address)
        );

        // Upsert permit record
        const { error: upsertErr } = await sb
          .from('permits')
          .upsert({
            site_id:          matchedSite?.id ?? null,
            permit_number:    permit.permitNumber,
            permit_type:      permit.type,
            permit_subtype:   permit.subType,
            status:           permit.status,
            issued_date:      permit.issued ? permit.issued.split('T')[0] : null,
            expires_date:     permit.expires ? permit.expires.split('T')[0] : null,
            address:          permit.address,
            zone:             permit.zone,
            work_description: permit.description,
            valuation:        permit.valuation,
            units:            permit.units,
            lat:              permit.lat,
            lng:              permit.lng,
            is_rti:           isRTI,
            raw_data:         permit,
            synced_at:        new Date().toISOString(),
          }, { onConflict: 'permit_number' });

        if (upsertErr) {
          console.error(`[sync] Upsert error for permit ${permit.permitNumber}:`, upsertErr.message);
          errors++;
          continue;
        }

        // If RTI newly detected and site matched, update site RTI status
        if (isRTI && matchedSite && !matchedSite.rti) {
          await sb.from('sites')
            .update({ rti: true, updated_at: new Date().toISOString() })
            .eq('id', matchedSite.id);
          console.log(`[sync] ✅ RTI status updated for site ${matchedSite.id} — ${matchedSite.addr}`);

          // Fire alerts for users watching this neighborhood/type
          await fireAlerts(matchedSite);
        }

        synced++;
      } catch (err) {
        console.error(`[sync] Error processing permit:`, err.message);
        errors++;
      }
    }

    // Log sync run
    await sb.from('sync_log').insert({
      source:  'LADBS',
      records: synced,
      status:  errors > 0 ? 'partial' : 'ok',
      error:   errors > 0 ? `${errors} errors` : null,
    });

    console.log(`[sync] Complete — ${synced} synced, ${errors} errors`);
  } catch (err) {
    console.error('[sync] Fatal sync error:', err.message);
    await sb.from('sync_log').insert({ source: 'LADBS', status: 'error', error: err.message });
  }
}

// ── Alert firing ──────────────────────────────────────────────────────────────
async function fireAlerts(site) {
  try {
    const { data: alerts } = await sb
      .from('alerts')
      .select('id, user_id, name, filters, frequency')
      .eq('active', true);

    if (!alerts?.length) return;

    for (const alert of alerts) {
      const f = alert.filters ?? {};

      // Check if this site matches the alert's filters
      const matches = (
        (!f.hood  || f.hood  === site.hood)  &&
        (!f.type  || f.type  === site.type)  &&
        (!f.zone  || f.zone  === site.zone)  &&
        (!f.rti   || site.rti)               &&
        (!f.minUnits || site.units >= f.minUnits)
      );

      if (matches) {
        console.log(`[alerts] Alert "${alert.name}" triggered for site ${site.id}`);
        // In production: send email via SendGrid / Resend
        // await sendAlertEmail(alert, site);
      }
    }
  } catch (err) {
    console.error('[alerts] Error firing alerts:', err.message);
  }
}

// ── Rent comp sync (monthly) ──────────────────────────────────────────────────
async function syncRentComps() {
  console.log('[sync] Rent comp sync — checking RentCast API...');

  if (!process.env.RENTCAST_API_KEY) {
    console.warn('[sync] RENTCAST_API_KEY not set — skipping rent comp sync');
    return;
  }

  const { RENTS, CAP_RATES } = await import('../src/data/submarkets.js');
  const neighborhoods = Object.keys(RENTS);

  for (const hood of neighborhoods) {
    try {
      // RentCast endpoint: /v1/markets?zipCode=XXXXX
      // Map neighborhood to zip codes (simplified)
      const zip = HOOD_ZIPS[hood];
      if (!zip) continue;

      const resp = await fetch(
        `https://api.rentcast.io/v1/markets?zipCode=${zip}&propertyType=Apartment&bedrooms=1`,
        { headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY } }
      );

      if (!resp.ok) continue;
      const data = await resp.json();
      const avgRent = data.averageRent;

      if (avgRent) {
        await sb.from('rent_comps').insert({
          neighborhood: hood,
          zip,
          bedroom_type: 'one',
          monthly_rent: Math.round(avgRent),
          source:       'rentcast',
          period:       new Date().toISOString().split('T')[0],
        });
        console.log(`[sync] Updated 1BR rent for ${hood}: $${Math.round(avgRent)}/mo`);
      }
    } catch (err) {
      console.error(`[sync] Rent comp error for ${hood}:`, err.message);
    }
  }
}

// ── Helpers ───────────────────────────────────────────────────────────────────
function normalizeAddr(addr) {
  return addr.toLowerCase().replace(/[.,#]/g, '').replace(/\s+/g, ' ').trim();
}

const HOOD_ZIPS = {
  'Silver Lake':   '90026',
  'Echo Park':     '90026',
  'Highland Park': '90042',
  'Los Feliz':     '90027',
  'Koreatown':     '90006',
  'Mid-Wilshire':  '90036',
  'Culver City':   '90232',
  'Mar Vista':     '90066',
  'West Adams':    '90016',
  'Boyle Heights': '90033',
};

// ── Cron schedule ─────────────────────────────────────────────────────────────
export function startSyncJobs() {
  // LADBS permit sync — 2 AM PT daily
  cron.schedule('0 2 * * *', syncLADBSPermits, { timezone: 'America/Los_Angeles' });

  // Rent comp sync — 3 AM on 1st of each month
  cron.schedule('0 3 1 * *', syncRentComps, { timezone: 'America/Los_Angeles' });

  console.log('✅ Sync jobs scheduled (LADBS: 2AM daily, RentCast: 1st of month)');
}

// Allow manual trigger: node api/jobs/sync.js --run-now
if (process.argv.includes('--run-now')) {
  syncLADBSPermits().then(() => process.exit(0));
}
