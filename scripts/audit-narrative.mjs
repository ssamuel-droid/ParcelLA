const baseUrl = String(process.env.API_BASE_URL || 'https://parcella-api-production.up.railway.app').replace(/\/$/, '');
const siteId = Number(process.env.NARRATIVE_HOUSE_SITE_ID || 482726);

const response = await fetch(`${baseUrl}/api/narrative/${siteId}`, {
  method: 'POST',
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    overrides: {},
    analysisSnapshot: {
      landCost: 936500,
      totalCost: 8468000,
      hardCosts: 6000000,
      softCosts: 1080000,
      carryCost: 451500,
      exitValue: 26513106,
      netProfit: 18045106,
      leveragedIRR: 100,
      resalePsf: 2020,
      buildingSf: 13118,
    },
  }),
});

const text = await response.text();
let payload = null;
try { payload = text ? JSON.parse(text) : null; } catch {}

if (!response.ok) {
  throw new Error(`${response.status} ${payload?.error || text.slice(0, 200)}`);
}
if (typeof payload?.narrative !== 'string' || payload.narrative.trim().length < 80) {
  throw new Error('Narrative response is missing usable analysis text');
}

console.log(`Permit-backed SFH narrative passed for site ${siteId}.`);
console.log(`Mode: ${payload.cached ? 'cached' : payload.fallback ? 'fallback' : 'Claude'}; characters: ${payload.narrative.length}.`);
