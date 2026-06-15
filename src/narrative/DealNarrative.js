/**
 * ParceLLA — AI Deal Narrative (Claude-powered)
 *
 * Generates a plain-English analyst summary for each development site:
 *   - Why the deal pencils (or doesn't)
 *   - Key risks and sensitivities
 *   - What a senior analyst would flag
 *   - Comparable context
 *
 * Uses Claude claude-sonnet-4-6 via the Anthropic API.
 * Cached in Supabase so each site only generates once (until assumptions change).
 */

// ── Server-side narrative generation ─────────────────────────────────────────
// Called from: POST /api/narrative/:siteId

export async function generateNarrative(site, model, demandScore) {
  const fmtM  = n => n >= 1e6 ? '$' + (Math.round(n/1e5)/10) + 'M'
                   : n >= 1e3 ? '$' + Math.round(n/1e3) + 'K'
                   : '$' + Math.round(n);
  const fmtP  = n => (Math.round(n * 10) / 10) + '%';
  const qLabel = v => v >= 18 ? 'strong' : v >= 12 ? 'moderate' : 'weak';

  const prompt = `You are a senior real estate development analyst at a top LA investment firm.
Write a concise, plain-English deal assessment for the following development site.

SITE DATA:
Address: ${site.addr}
Neighborhood: ${site.hood}
Project type: ${site.type}
Zoning: ${site.zone}
Units: ${site.units} (${site.usf} SF avg)
Status: ${site.rti ? 'RTI Approved' : site.isComp ? 'Off-market comp' : 'For sale'}
Land cost: ${fmtM(model.land)}${site.isComp ? ' (imputed)' : ' (asking price)'}
Demolition required: ${site.demo ? 'Yes' : 'No'}

UNDERWRITING MODEL:
All-in cost: ${fmtM(model.total)} (${fmtM(Math.round(model.total/site.units))}/unit)
Hard costs: ${fmtM(model.hard)} ($${model.hcpsf}/SF RSMeans 2024)
Soft costs: ${fmtM(model.soft)} (${Math.round(model.soft/model.hard*100)}% of hard)
Financing carry: ${fmtM(model.carry)}

INCOME:
Blended rent: ${fmtM(model.blend)}/unit/month
NOI (stabilized): ${fmtM(model.noi)}
Entry cap rate: ${fmtP(model.entryCap * 100)}
Exit cap rate: ${fmtP(model.exitCap * 100)} (+25bps expansion)

RETURNS:
Exit value: ${fmtM(model.exitValue)}
Net profit: ${fmtM(model.netProfit)}
IRR (levered, 5-yr): ${model.irrV}% — ${qLabel(model.irrV)} relative to LA market
Cap rate on cost: ${model.capOnCost}%
Dev spread: ${model.devSpreadPct}% above all-in cost
Cash-on-cash: ${model.coc}%
Equity multiple: ${model.eqMult}x

MARKET CONTEXT:
Neighborhood demand score: ${demandScore?.score ?? 'N/A'}/100 (${demandScore?.label ?? 'N/A'})
3-year rent growth: ${demandScore?.rentGrowth3yr ? Math.round(demandScore.rentGrowth3yr * 100) + '%' : 'N/A'}
Property tax (Prop 13): ${fmtM(model.propTax)}/yr (1.25% of land basis, escalating 2%/yr)

Write 2-3 paragraphs as a senior analyst would write in an investment memo. Cover:
1. Why this deal does or doesn't pencil — what's driving the return
2. The main risk(s) an LP or lender would ask about
3. One specific insight a less sophisticated buyer would miss

Be specific with numbers. Be direct and opinionated. Do not use bullet points.
Maximum 200 words. No preamble — start directly with the analysis.`;

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method:  'POST',
    headers: {
      'Content-Type':      'application/json',
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model:      'claude-sonnet-4-6',
      max_tokens:  400,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });

  if (!response.ok) {
    const err = await response.json();
    throw new Error(`Claude API error: ${err.error?.message ?? response.status}`);
  }

  const data = await response.json();
  return data.content[0]?.text ?? '';
}

// ── Cache layer (Supabase) ────────────────────────────────────────────────────
export async function getNarrativeCached(siteId, modelHash, supabase) {
  const { data } = await supabase
    .from('narratives')
    .select('narrative, created_at')
    .match({ site_id: siteId, model_hash: modelHash })
    .maybeSingle();
  return data?.narrative ?? null;
}

export async function cacheNarrative(siteId, modelHash, narrative, supabase) {
  await supabase.from('narratives').upsert({
    site_id:    siteId,
    model_hash: modelHash,
    narrative,
    created_at: new Date().toISOString(),
  });
}

// Simple hash of model assumptions for cache invalidation
export function hashModel(model) {
  const key = `${model.land}|${model.hcpsf}|${model.exitCap}|${model.soft}`;
  return key.split('').reduce((h, c) => (h * 31 + c.charCodeAt(0)) & 0xffffffff, 0)
    .toString(16);
}

// ── Supabase table ────────────────────────────────────────────────────────────
export const narrativesSchema = `
CREATE TABLE IF NOT EXISTS narratives (
  site_id     INTEGER REFERENCES sites(id) ON DELETE CASCADE,
  model_hash  TEXT NOT NULL,
  narrative   TEXT NOT NULL,
  created_at  TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (site_id, model_hash)
);
ALTER TABLE narratives ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Narratives are public readable" ON narratives FOR SELECT USING (true);
`;

// ── Express route ─────────────────────────────────────────────────────────────
// POST /api/narrative/:siteId
export async function narrativeRoute(req, res, next) {
  try {
    const siteId = +req.params.siteId;
    const { overrides = {} } = req.body;

    const { SITES }         = await import('../data/sites.js');
    const { runModel }      = await import('../model/financialModel.js');
    const { scoreSiteDemand, SUBMARKET_CENSUS_ESTIMATES } = await import('../scoring/DemandScore.js');
    const { createClient }  = await import('@supabase/supabase-js');

    const site = SITES.find(s => s.id === siteId);
    if (!site) return res.status(404).json({ error: 'Site not found' });

    const model = runModel(site, overrides);
    const hash  = hashModel(model);

    const sb = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);

    // Check cache
    const cached = await getNarrativeCached(siteId, hash, sb);
    if (cached) return res.json({ narrative: cached, cached: true });

    // Generate demand score for context
    let demandScore = null;
    try {
      demandScore = await scoreSiteDemand({
        ...site,
        demographics: SUBMARKET_CENSUS_ESTIMATES[site.hood],
      });
    } catch (e) { /* non-fatal */ }

    // Generate narrative
    const narrative = await generateNarrative(site, model, demandScore);

    // Cache it
    await cacheNarrative(siteId, hash, narrative, sb);

    res.json({ narrative, cached: false });
  } catch (err) { next(err); }
}
