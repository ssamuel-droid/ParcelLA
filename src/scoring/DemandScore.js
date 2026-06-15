/**
 * ParceLLA — Demand Scoring Engine
 *
 * Scores each site on renter demand fundamentals:
 *   1. Renter concentration (Census ACS B25003)
 *   2. Income-to-rent ratio (affordability ceiling)
 *   3. Population density (Census B01003)
 *   4. Rent growth trajectory (trailing 3-year)
 *   5. Transit proximity (walk score proxy via Mapbox isochrone)
 *   6. Job center proximity (major employment nodes)
 *   7. Permit velocity (LADBS — supply pipeline)
 *
 * Output: 0–100 composite demand score + per-factor breakdown
 *
 * Dependencies: Census API, Mapbox API, Socrata (LADBS)
 */

import { censusGeocode, fetchCensusACS } from './laOpenData.js';
import { MAP_COORDS } from './submarkets.js';

// ── LA job centers (major employment nodes) ───────────────────────────────────
const JOB_CENTERS = [
  { name: 'Downtown LA',     lat: 34.0522, lng: -118.2437, weight: 1.0 },
  { name: 'Century City',    lat: 34.0560, lng: -118.4155, weight: 0.9 },
  { name: 'Westwood / UCLA', lat: 34.0689, lng: -118.4452, weight: 0.85 },
  { name: 'Hollywood',       lat: 34.0928, lng: -118.3287, weight: 0.8 },
  { name: 'El Segundo',      lat: 33.9196, lng: -118.4165, weight: 0.75 },
  { name: 'Culver City',     lat: 34.0211, lng: -118.3965, weight: 0.7 },
  { name: 'Koreatown',       lat: 34.0586, lng: -118.3006, weight: 0.65 },
  { name: 'Pasadena',        lat: 34.1478, lng: -118.1445, weight: 0.6 },
];

// ── LA Metro rail stations (proximity = transit score) ─────────────────────────
const METRO_STATIONS = [
  { name: 'Vermont/Beverly',    lat: 34.0756, lng: -118.2922, line: 'B' },
  { name: 'Vermont/Wilshire',   lat: 34.0625, lng: -118.2922, line: 'B' },
  { name: 'Vermont/Santa Monica', lat: 34.0900, lng: -118.2919, line: 'B' },
  { name: 'Wilshire/Western',   lat: 34.0624, lng: -118.3089, line: 'D' },
  { name: 'Wilshire/Normandie', lat: 34.0624, lng: -118.2974, line: 'D' },
  { name: 'Hollywood/Highland', lat: 34.1019, lng: -118.3397, line: 'B' },
  { name: 'Hollywood/Vine',     lat: 34.1017, lng: -118.3267, line: 'B' },
  { name: 'Union Station',      lat: 34.0560, lng: -118.2365, line: 'A/B/D/E' },
  { name: 'Culver City',        lat: 34.0109, lng: -118.3896, line: 'E' },
  { name: 'Expo/Western',       lat: 34.0271, lng: -118.3089, line: 'E' },
  { name: 'Jefferson/USC',      lat: 34.0196, lng: -118.2808, line: 'E' },
  { name: 'DTLA/7th/Metro',     lat: 34.0483, lng: -118.2589, line: 'A/E' },
];

// ── Submarket trailing rent growth (2021–2024) ────────────────────────────────
const RENT_GROWTH_3YR = {
  'Silver Lake':   0.082,   // 8.2% cumulative
  'Echo Park':     0.071,
  'Highland Park': 0.094,   // gentrification premium
  'Los Feliz':     0.063,
  'Koreatown':     0.058,
  'Mid-Wilshire':  0.061,
  'Culver City':   0.087,   // tech hub spillover
  'Mar Vista':     0.075,
  'West Adams':    0.112,   // strongest growth corridor
  'Boyle Heights': 0.068,
};

// ── Helper: haversine distance in miles ───────────────────────────────────────
function distanceMiles(lat1, lng1, lat2, lng2) {
  const R = 3958.8;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat/2)**2 +
    Math.cos(lat1 * Math.PI/180) * Math.cos(lat2 * Math.PI/180) * Math.sin(dLng/2)**2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
}

// ── Factor scoring functions (each returns 0–100) ──────────────────────────────

function scoreRenterConcentration(renterPct) {
  // LA average renter pct ~60%. Score peaks at 75%+
  if (renterPct >= 75) return 100;
  if (renterPct >= 65) return 85;
  if (renterPct >= 55) return 70;
  if (renterPct >= 45) return 55;
  if (renterPct >= 35) return 40;
  return 20;
}

function scoreIncomeToRent(medianIncome, avgRent) {
  // Rule of thumb: rent = ~30% of gross income = healthy
  // Annual rent / median income ratio
  const annualRent = avgRent * 12;
  const ratio = annualRent / medianIncome;
  // Lower ratio = more affordable = more demand headroom
  if (ratio <= 0.25) return 95;   // very affordable, strong demand
  if (ratio <= 0.30) return 85;
  if (ratio <= 0.35) return 70;
  if (ratio <= 0.40) return 55;
  if (ratio <= 0.45) return 40;
  return 25;                       // severely cost-burdened
}

function scorePopDensity(popPerSqMile) {
  // Higher density = more renters per acre = stronger demand
  if (popPerSqMile >= 20000) return 100;
  if (popPerSqMile >= 15000) return 90;
  if (popPerSqMile >= 10000) return 75;
  if (popPerSqMile >= 7000)  return 60;
  if (popPerSqMile >= 4000)  return 45;
  return 30;
}

function scoreRentGrowth(growth3yr) {
  // Trailing rent growth signals demand momentum
  if (growth3yr >= 0.12) return 100;
  if (growth3yr >= 0.09) return 85;
  if (growth3yr >= 0.07) return 70;
  if (growth3yr >= 0.05) return 55;
  if (growth3yr >= 0.03) return 40;
  return 25;
}

function scoreTransitProximity(lat, lng) {
  // Score based on distance to nearest Metro station
  // <0.25mi = walkable = 100, >1mi = 30
  const distances = METRO_STATIONS.map(s => distanceMiles(lat, lng, s.lat, s.lng));
  const nearest = Math.min(...distances);
  if (nearest <= 0.25) return 100;
  if (nearest <= 0.50) return 85;
  if (nearest <= 0.75) return 70;
  if (nearest <= 1.00) return 55;
  if (nearest <= 1.50) return 40;
  return 25;
}

function scoreJobProximity(lat, lng) {
  // Weighted proximity to job centers
  // Each center contributes: weight × (1 - distance/10) clamped to 0
  let score = 0;
  for (const jc of JOB_CENTERS) {
    const dist = distanceMiles(lat, lng, jc.lat, jc.lng);
    const contribution = jc.weight * Math.max(0, 1 - dist / 10);
    score += contribution;
  }
  // Normalize to 0–100 (max theoretical ~5.5)
  return Math.min(100, Math.round(score / 5.5 * 100));
}

function scorePermitVelocity(permitCount) {
  // Fewer recent permits in the submarket = less competition = better demand
  // This is inverse: high pipeline supply = lower score
  if (permitCount <= 5)   return 90;
  if (permitCount <= 15)  return 75;
  if (permitCount <= 30)  return 60;
  if (permitCount <= 50)  return 45;
  return 30;
}

// ── Composite demand score ─────────────────────────────────────────────────────
const FACTOR_WEIGHTS = {
  renterConcentration: 0.20,
  incomeToRent:        0.15,
  popDensity:          0.10,
  rentGrowth:          0.20,
  transitProximity:    0.15,
  jobProximity:        0.15,
  permitVelocity:      0.05,
};

export function calcDemandScore(factors) {
  let total = 0;
  const breakdown = {};
  for (const [key, weight] of Object.entries(FACTOR_WEIGHTS)) {
    const raw = factors[key] ?? 50;
    const weighted = raw * weight;
    breakdown[key] = { raw: Math.round(raw), weighted: Math.round(weighted * 10) / 10, weight };
    total += weighted;
  }
  return {
    score:     Math.round(total),
    grade:     total >= 80 ? 'A' : total >= 65 ? 'B' : total >= 50 ? 'C' : 'D',
    label:     total >= 80 ? 'Strong demand' : total >= 65 ? 'Good demand' : total >= 50 ? 'Moderate' : 'Weak',
    color:     total >= 80 ? '#1d9e75' : total >= 65 ? '#ef9f27' : total >= 50 ? '#378add' : '#e24b4a',
    breakdown,
  };
}

// ── Full site demand analysis ──────────────────────────────────────────────────
export async function scoreSiteDemand(site) {
  const hood = site.hood;
  const coords = site.coordinates ?? MAP_COORDS[hood];
  if (!coords) throw new Error(`No coordinates for ${hood}`);

  const { lat, lng } = coords;

  // Census demographics (with fallback to submarket estimates)
  let demographics = site.demographics;
  if (!demographics) {
    try {
      const geo = await censusGeocode(`${site.addr}, Los Angeles CA`);
      demographics = await fetchCensusACS(geo.state, geo.county, geo.tract);
    } catch {
      // Fallback estimates by submarket
      demographics = SUBMARKET_CENSUS_ESTIMATES[hood] ?? {
        renterPct: 62, medianHouseholdIncome: 68000, totalPopulation: 8500,
      };
    }
  }

  // Estimated avg rent for income ratio calc
  const { RENTS } = await import('./submarkets.js');
  const R = RENTS[hood];
  const avgRent = R ? (R.studio * 0.2 + R.one * 0.45 + R.two * 0.25 + R.three * 0.10) : 2500;

  // Approx pop density (tract area estimated from pop)
  const popPerSqMile = demographics.totalPopulation
    ? demographics.totalPopulation * 8   // LA avg ~8x population to density ratio
    : 12000;

  const factors = {
    renterConcentration: scoreRenterConcentration(demographics.renterPct ?? 62),
    incomeToRent:        scoreIncomeToRent(demographics.medianHouseholdIncome ?? 68000, avgRent),
    popDensity:          scorePopDensity(popPerSqMile),
    rentGrowth:          scoreRentGrowth(RENT_GROWTH_3YR[hood] ?? 0.06),
    transitProximity:    scoreTransitProximity(lat, lng),
    jobProximity:        scoreJobProximity(lat, lng),
    permitVelocity:      scorePermitVelocity(site.nearbyPermits ?? 20),
  };

  const result = calcDemandScore(factors);

  return {
    ...result,
    hood,
    lat,
    lng,
    rentGrowth3yr:    RENT_GROWTH_3YR[hood],
    nearestStation:   METRO_STATIONS.reduce((a, b) =>
      distanceMiles(lat, lng, a.lat, a.lng) < distanceMiles(lat, lng, b.lat, b.lng) ? a : b
    ),
    closestJobCenter: JOB_CENTERS.reduce((a, b) =>
      distanceMiles(lat, lng, a.lat, a.lng) < distanceMiles(lat, lng, b.lat, b.lng) ? a : b
    ),
    demographics,
  };
}

// ── Submarket census estimates (fallback when Census API unavailable) ───────────
export const SUBMARKET_CENSUS_ESTIMATES = {
  'Silver Lake':   { renterPct: 68, medianHouseholdIncome: 82000, totalPopulation: 9200 },
  'Echo Park':     { renterPct: 72, medianHouseholdIncome: 71000, totalPopulation: 11400 },
  'Highland Park': { renterPct: 58, medianHouseholdIncome: 63000, totalPopulation: 8800 },
  'Los Feliz':     { renterPct: 65, medianHouseholdIncome: 96000, totalPopulation: 7600 },
  'Koreatown':     { renterPct: 82, medianHouseholdIncome: 48000, totalPopulation: 22000 },
  'Mid-Wilshire':  { renterPct: 74, medianHouseholdIncome: 67000, totalPopulation: 14500 },
  'Culver City':   { renterPct: 60, medianHouseholdIncome: 108000, totalPopulation: 6800 },
  'Mar Vista':     { renterPct: 55, medianHouseholdIncome: 112000, totalPopulation: 7200 },
  'West Adams':    { renterPct: 70, medianHouseholdIncome: 58000, totalPopulation: 13600 },
  'Boyle Heights': { renterPct: 75, medianHouseholdIncome: 42000, totalPopulation: 19800 },
};

// ── Batch score all sites ──────────────────────────────────────────────────────
export async function scoreAllSites(sites) {
  const results = await Promise.allSettled(sites.map(s => scoreSiteDemand(s)));
  return results.map((r, i) => ({
    siteId: sites[i].id,
    ...(r.status === 'fulfilled' ? r.value : { score: 50, grade: 'C', label: 'Unknown', error: r.reason?.message }),
  }));
}
