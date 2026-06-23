// LA Submarket Data — 2024
// Sources: CoStar, Zillow, local broker surveys

// 2024 LA Market Rents — New Construction Premium
// Source: CoStar Q3 2024, Apartment List, local broker surveys
// These reflect new construction rents (10-15% premium over existing stock)
export const RENTS = {
  'Silver Lake':   { studio: 2600, one: 3400, two: 4400, three: 5800 },
  'Echo Park':     { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Highland Park': { studio: 2200, one: 2850, two: 3700, three: 4900 },
  'Los Feliz':     { studio: 2800, one: 3600, two: 4700, three: 6200 },
  'Koreatown':     { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Mid-Wilshire':  { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'Culver City':   { studio: 2900, one: 3700, two: 4800, three: 6300 },
  'Mar Vista':     { studio: 2700, one: 3500, two: 4500, three: 5900 },
  'West Adams':    { studio: 2300, one: 2950, two: 3800, three: 5000 },
  'Boyle Heights': { studio: 1900, one: 2450, two: 3200, three: 4200 },
};

// Stabilized market cap rates — 2024 LA multifamily development exits
// Source: CoStar Q3 2024, local broker surveys, sold comp validation
// Exit cap = entry cap + 25bps (cap rate expansion at sale)
export const CAP_RATES = {
  'Silver Lake':   0.0475,  // premium westside-adjacent, strong demand
  'Echo Park':     0.0500,
  'Highland Park': 0.0525,  // improving but still value-add market
  'Los Feliz':     0.0475,  // premium neighborhood, low vacancy
  'Koreatown':     0.0525,  // high density, strong renter demand
  'Mid-Wilshire':  0.0500,
  'Culver City':   0.0475,  // tech-driven demand, low supply
  'Mar Vista':     0.0500,
  'West Adams':    0.0525,  // emerging, strong growth but higher risk
  'Boyle Heights': 0.0575,  // highest yield, lower price basis
};

// RSMeans 2024 — Los Angeles Metro
// Source: RSMeans Building Construction Cost Data, 82nd Edition
export const RSMEANS = {
  'Multifamily': 285,  // Type V wood frame, 3–5 stories
  'Mixed-Use':   320,  // Type III/V podium, ground-floor retail
  'Condo/TH':    340,  // Type III concrete/wood, higher finish
  'SFR+ADU':     275,  // Single family + accessory dwelling unit
};

// Scale discounts (volume pricing, site efficiency)
export const SCALE_DISCOUNTS = [
  { minSF: 100000, discount: 0.07 },
  { minSF: 50000,  discount: 0.05 },
];

export const NEIGHBORHOODS = Object.keys(RENTS);

export const MAP_COORDS = {
  'Silver Lake':   { lat: 34.0839, lng: -118.2703 },
  'Echo Park':     { lat: 34.0784, lng: -118.2607 },
  'Highland Park': { lat: 34.1084, lng: -118.2042 },
  'Los Feliz':     { lat: 34.1019, lng: -118.2923 },
  'Koreatown':     { lat: 34.0586, lng: -118.3006 },
  'Mid-Wilshire':  { lat: 34.0626, lng: -118.3404 },
  'Culver City':   { lat: 34.0211, lng: -118.3965 },
  'Mar Vista':     { lat: 34.0011, lng: -118.4284 },
  'West Adams':    { lat: 34.0139, lng: -118.3338 },
  'Boyle Heights': { lat: 34.0298, lng: -118.2154 },
};
