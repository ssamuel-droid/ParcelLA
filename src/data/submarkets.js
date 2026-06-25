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
  // Additional LA neighborhoods
  'Venice':        { studio: 2900, one: 3700, two: 4800, three: 6300 },
  'Playa Vista':   { studio: 3000, one: 3900, two: 5000, three: 6500 },
  'Brentwood':     { studio: 2900, one: 3800, two: 4900, three: 6400 },
  'Pacific Palisades': { studio: 3200, one: 4100, two: 5300, three: 7000 },
  'Westchester':   { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Palms':         { studio: 2400, one: 3100, two: 4000, three: 5200 },
  'Sawtelle':      { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'West LA':       { studio: 2600, one: 3300, two: 4300, three: 5600 },
  'Eagle Rock':    { studio: 2200, one: 2800, two: 3650, three: 4800 },
  'Atwater Village': { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Glassell Park': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Mount Washington': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Lincoln Heights': { studio: 1900, one: 2400, two: 3100, three: 4100 },
  'El Sereno':     { studio: 1850, one: 2350, two: 3000, three: 3950 },
  'Hancock Park':  { studio: 2600, one: 3300, two: 4300, three: 5700 },
  'Larchmont':     { studio: 2500, one: 3200, two: 4100, three: 5400 },
  'Hollywood':     { studio: 2300, one: 2950, two: 3800, three: 5000 },
  'East Hollywood': { studio: 2200, one: 2800, two: 3600, three: 4800 },
  'Hollywood Hills': { studio: 2800, one: 3600, two: 4700, three: 6200 },
  'Studio City':   { studio: 2400, one: 3100, two: 4000, three: 5300 },
  'Sherman Oaks':  { studio: 2200, one: 2800, two: 3650, three: 4800 },
  'Encino':        { studio: 2200, one: 2800, two: 3650, three: 4800 },
  'Tarzana':       { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'Woodland Hills': { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'Van Nuys':      { studio: 1700, one: 2150, two: 2800, three: 3700 },
  'North Hollywood': { studio: 1900, one: 2400, two: 3100, three: 4100 },
  'Reseda':        { studio: 1650, one: 2100, two: 2700, three: 3550 },
  'Canoga Park':   { studio: 1700, one: 2150, two: 2800, three: 3700 },
  'Granada Hills': { studio: 1800, one: 2300, two: 2950, three: 3900 },
  'Northridge':    { studio: 1750, one: 2200, two: 2850, three: 3750 },
  'Panorama City': { studio: 1600, one: 2050, two: 2650, three: 3500 },
  'Pacoima':       { studio: 1550, one: 1950, two: 2550, three: 3350 },
  'West Adams (Jefferson Park)': { studio: 2100, one: 2700, two: 3500, three: 4600 },
  'Leimert Park':  { studio: 2000, one: 2550, two: 3300, three: 4350 },
  'Hyde Park':     { studio: 1900, one: 2400, two: 3100, three: 4100 },
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
