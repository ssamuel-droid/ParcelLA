// LA Submarket Data — 2024
// Sources: CoStar, Zillow, local broker surveys

export const RENTS = {
  'Silver Lake':   { studio: 2200, one: 2800, two: 3600, three: 4800 },
  'Echo Park':     { studio: 2000, one: 2600, two: 3300, three: 4400 },
  'Highland Park': { studio: 1850, one: 2350, two: 3000, three: 4000 },
  'Los Feliz':     { studio: 2300, one: 3000, two: 3900, three: 5200 },
  'Koreatown':     { studio: 1700, one: 2200, two: 2900, three: 3800 },
  'Mid-Wilshire':  { studio: 2000, one: 2600, two: 3400, three: 4500 },
  'Culver City':   { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Mar Vista':     { studio: 2300, one: 2950, two: 3800, three: 5000 },
  'West Adams':    { studio: 1900, one: 2450, two: 3100, three: 4100 },
  'Boyle Heights': { studio: 1600, one: 2050, two: 2700, three: 3500 },
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
