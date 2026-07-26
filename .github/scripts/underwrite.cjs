// ParceLLA — Underwriting Engine
const https = require('https');

const SB_URL = process.env.SUPABASE_URL?.replace(/\/$/, '');
const SB_KEY = process.env.SUPABASE_SERVICE_KEY;

if (!SB_URL || !SB_KEY) {
  throw new Error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required');
}

function req(method, path, body) {
  return new Promise((resolve, reject) => {
    const u = new URL(SB_URL + path);
    const data = body ? JSON.stringify(body) : null;
    const options = {
      hostname: u.hostname,
      path: u.pathname + u.search,
      method,
      timeout: 30000,  // 30 second timeout
      headers: {
        'Authorization': 'Bearer ' + SB_KEY,
        'apikey': SB_KEY,
        'Accept': 'application/json',
        'Content-Type': 'application/json',
        'Prefer': 'return=minimal,resolution=merge-duplicates',
      }
    };
    if (data) options.headers['Content-Length'] = Buffer.byteLength(data);
    const r = https.request(options, res => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(d) }); }
        catch(e) { resolve({ status: res.statusCode, data: d }); }
      });
    });
    r.on('timeout', () => { r.destroy(); reject(new Error('Request timeout')); });
    r.on('error', reject);
    if (data) r.write(data);
    r.end();
  });
}

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function loadRecentSoldComps(recencyDays = LAND_COMP_RECENCY_DAYS) {
  const cutoff = new Date(Date.now() - recencyDays * 86400000).toISOString().slice(0, 10);
  const select = [
    'address','neighborhood','project_type','units','avg_unit_sf',
    'sale_price','sale_date','price_per_unit','price_per_sf',
    'source','recorder_document_number'
  ].join(',');
  const rows = [];
  let off = 0;

  while (true) {
    const path = `/rest/v1/sold_comps?select=${select}&sale_date=gte.${cutoff}&limit=1000&offset=${off}&order=sale_date.desc`;
    const r = await req('GET', path);
    if (r.status >= 400) {
      console.log('Recent sold comps unavailable; using permit valuation fallback:', typeof r.data === 'string' ? r.data.slice(0, 180) : JSON.stringify(r.data).slice(0, 180));
      return rows;
    }
    if (!Array.isArray(r.data) || !r.data.length) break;
    rows.push(...r.data);
    if (r.data.length < 1000) break;
    off += 1000;
    await sleep(100);
  }

  return rows;
}

const RENTS = {
  'Silver Lake': {s:2600,o:3400,t:4400,th:5800}, 'Los Feliz': {s:2800,o:3600,t:4700,th:6200},
  'Echo Park': {s:2400,o:3100,t:4000,th:5300}, 'Atwater Village': {s:2400,o:3100,t:4000,th:5300},
  'Eagle Rock': {s:2200,o:2800,t:3650,th:4800}, 'Highland Park': {s:2200,o:2850,t:3700,th:4900},
  'Glassell Park': {s:2100,o:2700,t:3500,th:4600}, 'Mount Washington': {s:2100,o:2700,t:3500,th:4600},
  'Lincoln Heights': {s:1900,o:2400,t:3100,th:4100}, 'Boyle Heights': {s:1900,o:2450,t:3200,th:4200},
  'El Sereno': {s:1850,o:2350,t:3000,th:3950}, 'Koreatown': {s:2100,o:2700,t:3500,th:4600},
  'Mid-Wilshire': {s:2500,o:3200,t:4100,th:5400}, 'Hancock Park': {s:2600,o:3300,t:4300,th:5700},
  'Hollywood': {s:2300,o:2950,t:3800,th:5000}, 'Hollywood Hills': {s:2800,o:3600,t:4700,th:6200},
  'East Hollywood': {s:2200,o:2800,t:3600,th:4800}, 'Studio City': {s:2400,o:3100,t:4000,th:5300},
  'Sherman Oaks': {s:2200,o:2800,t:3650,th:4800}, 'Encino': {s:2200,o:2800,t:3650,th:4800},
  'West Adams': {s:2300,o:2950,t:3800,th:5000}, 'Leimert Park': {s:2000,o:2550,t:3300,th:4350},
  'Culver City': {s:2900,o:3700,t:4800,th:6300}, 'Mar Vista': {s:2700,o:3500,t:4500,th:5900},
  'Venice': {s:2900,o:3700,t:4800,th:6300}, 'West LA': {s:2600,o:3300,t:4300,th:5600},
  'Brentwood': {s:2900,o:3800,t:4900,th:6400}, 'Pacific Palisades': {s:3200,o:4100,t:5300,th:7000},
  'Van Nuys': {s:1700,o:2150,t:2800,th:3700}, 'North Hollywood': {s:1900,o:2400,t:3100,th:4100},
  'Woodland Hills': {s:2000,o:2550,t:3300,th:4350}, 'Reseda': {s:1650,o:2100,t:2700,th:3550},
  'Panorama City': {s:1600,o:2050,t:2650,th:3500}, 'Pacoima': {s:1550,o:1950,t:2550,th:3350},
  'Granada Hills': {s:1800,o:2300,t:2950,th:3900}, 'Northridge': {s:1750,o:2200,t:2850,th:3750},
  'Chatsworth': {s:1900,o:2400,t:3100,th:4100},
};
const CAPS = {
  'Venice':0.0425,'Pacific Palisades':0.0400,'Brentwood':0.0425,'Playa Vista':0.0425,
  'Silver Lake':0.0475,'Los Feliz':0.0475,'Hollywood Hills':0.0475,'Culver City':0.0450,
  'West LA':0.0450,'Mar Vista':0.0475,'Studio City':0.0475,'Hancock Park':0.0475,
  'Echo Park':0.0500,'Atwater Village':0.0500,'Mid-Wilshire':0.0500,'Hollywood':0.0500,
  'Sherman Oaks':0.0500,'Encino':0.0500,'East Hollywood':0.0525,'Highland Park':0.0525,
  'Eagle Rock':0.0500,'Glassell Park':0.0525,'Mount Washington':0.0525,'Koreatown':0.0525,
  'West Adams':0.0525,'Lincoln Heights':0.0550,'North Hollywood':0.0525,'Woodland Hills':0.0525,
  'Granada Hills':0.0525,'Northridge':0.0550,'Leimert Park':0.0550,'El Sereno':0.0575,
  'Boyle Heights':0.0575,'Van Nuys':0.0550,'Reseda':0.0575,'Canoga Park':0.0575,
  'Panorama City':0.0600,'Pacoima':0.0625,'Chatsworth':0.0525,
};
const HC = {'Multifamily':285,'Mixed-Use':320,'Condo/TH':340,'New House':275};
let LAND_BENCHMARKS = null;
let estimateLandBasisFromComps = () => null;
let LAND_COMP_RECENCY_DAYS = 1095;

const BOXES = [
  {h:'Silver Lake',lat0:34.070,lat1:34.105,lng0:-118.290,lng1:-118.250},
  {h:'Echo Park',lat0:34.060,lat1:34.085,lng0:-118.280,lng1:-118.248},
  {h:'Los Feliz',lat0:34.095,lat1:34.125,lng0:-118.310,lng1:-118.270},
  {h:'Highland Park',lat0:34.095,lat1:34.135,lng0:-118.235,lng1:-118.175},
  {h:'Eagle Rock',lat0:34.125,lat1:34.155,lng0:-118.225,lng1:-118.185},
  {h:'Atwater Village',lat0:34.110,lat1:34.130,lng0:-118.275,lng1:-118.250},
  {h:'Glassell Park',lat0:34.095,lat1:34.120,lng0:-118.255,lng1:-118.225},
  {h:'Mount Washington',lat0:34.095,lat1:34.120,lng0:-118.220,lng1:-118.195},
  {h:'Boyle Heights',lat0:34.020,lat1:34.060,lng0:-118.225,lng1:-118.190},
  {h:'El Sereno',lat0:34.065,lat1:34.095,lng0:-118.190,lng1:-118.155},
  {h:'Lincoln Heights',lat0:34.060,lat1:34.090,lng0:-118.225,lng1:-118.200},
  {h:'Koreatown',lat0:34.045,lat1:34.075,lng0:-118.325,lng1:-118.285},
  {h:'Mid-Wilshire',lat0:34.055,lat1:34.075,lng0:-118.365,lng1:-118.325},
  {h:'Hancock Park',lat0:34.070,lat1:34.090,lng0:-118.355,lng1:-118.325},
  {h:'Hollywood',lat0:34.085,lat1:34.110,lng0:-118.340,lng1:-118.300},
  {h:'East Hollywood',lat0:34.085,lat1:34.105,lng0:-118.300,lng1:-118.275},
  {h:'Hollywood Hills',lat0:34.105,lat1:34.145,lng0:-118.360,lng1:-118.300},
  {h:'West Adams',lat0:34.000,lat1:34.035,lng0:-118.355,lng1:-118.315},
  {h:'Leimert Park',lat0:33.990,lat1:34.015,lng0:-118.335,lng1:-118.310},
  {h:'Culver City',lat0:33.995,lat1:34.030,lng0:-118.420,lng1:-118.375},
  {h:'Mar Vista',lat0:33.982,lat1:34.010,lng0:-118.455,lng1:-118.415},
  {h:'Venice',lat0:33.975,lat1:34.005,lng0:-118.480,lng1:-118.445},
  {h:'West LA',lat0:34.030,lat1:34.060,lng0:-118.455,lng1:-118.420},
  {h:'Brentwood',lat0:34.040,lat1:34.075,lng0:-118.490,lng1:-118.450},
  {h:'Pacific Palisades',lat0:34.030,lat1:34.080,lng0:-118.545,lng1:-118.490},
  {h:'Studio City',lat0:34.130,lat1:34.160,lng0:-118.405,lng1:-118.370},
  {h:'Sherman Oaks',lat0:34.140,lat1:34.175,lng0:-118.465,lng1:-118.415},
  {h:'Van Nuys',lat0:34.175,lat1:34.215,lng0:-118.465,lng1:-118.415},
  {h:'North Hollywood',lat0:34.155,lat1:34.195,lng0:-118.390,lng1:-118.350},
  {h:'Encino',lat0:34.145,lat1:34.180,lng0:-118.530,lng1:-118.480},
  {h:'Woodland Hills',lat0:34.155,lat1:34.200,lng0:-118.640,lng1:-118.580},
  {h:'Reseda',lat0:34.190,lat1:34.225,lng0:-118.545,lng1:-118.500},
  {h:'Northridge',lat0:34.220,lat1:34.260,lng0:-118.555,lng1:-118.500},
  {h:'Granada Hills',lat0:34.260,lat1:34.300,lng0:-118.540,lng1:-118.490},
  {h:'Chatsworth',lat0:34.240,lat1:34.280,lng0:-118.620,lng1:-118.565},
  {h:'Panorama City',lat0:34.210,lat1:34.240,lng0:-118.455,lng1:-118.415},
  {h:'Pacoima',lat0:34.240,lat1:34.280,lng0:-118.410,lng1:-118.370},
];

function hood(lat, lng, addr) {
  if (lat && lng) {
    for (const b of BOXES) {
      if (lat>=b.lat0 && lat<=b.lat1 && lng>=b.lng0 && lng<=b.lng1) return b.h;
    }
  }
  const a = (addr||'').toUpperCase();
  if (a.includes('SILVER LAKE')||a.includes('SILVERLAKE')) return 'Silver Lake';
  if (a.includes('ECHO PARK')) return 'Echo Park';
  if (a.includes('LOS FELIZ')) return 'Los Feliz';
  if (a.includes('HIGHLAND PARK')) return 'Highland Park';
  if (a.includes('CULVER')) return 'Culver City';
  if (a.includes('MAR VISTA')) return 'Mar Vista';
  if (a.includes('WEST ADAMS')) return 'West Adams';
  if (a.includes('BOYLE')) return 'Boyle Heights';
  if (a.includes('WILSHIRE')) return 'Mid-Wilshire';
  if (a.includes('VENICE')) return 'Venice';
  if (a.includes('STUDIO CITY')) return 'Studio City';
  if (a.includes('SHERMAN OAKS')) return 'Sherman Oaks';
  if (a.includes('VAN NUYS')) return 'Van Nuys';
  if (a.includes('NORTH HOLLYWOOD')||a.includes('NO. HOLLYWOOD')) return 'North Hollywood';
  if (a.includes('WOODLAND HILLS')) return 'Woodland Hills';
  if (a.includes('RESEDA')) return 'Reseda';
  if (a.includes('NORTHRIDGE')) return 'Northridge';
  if (a.includes('GRANADA HILLS')) return 'Granada Hills';
  if (a.includes('CANOGA PARK')) return 'Canoga Park';
  if (a.includes('CHATSWORTH')) return 'Chatsworth';
  if (a.includes('PANORAMA CITY')) return 'Panorama City';
  if (a.includes('PACOIMA')) return 'Pacoima';
  return 'Koreatown';
}

const EXCLUDED_PROJECT_TEXT = /(adu|jadu|junior adu|accessory dwelling|\baddition\b|\bremodel\b|\balteration\b|\bconversion\b|\bgazebo\b|\bpool\b|\bspa\b|\bshed\b|\bcarport\b|\bretaining wall\b|\bfence\b|\breroof\b|\bre-roof\b|\bsolar\b)/i;
const RESIDENTIAL_PROJECT_TEXT = /(apartment|dwelling|residential|multifamily|multi-family|mixed[- ]use|\bhousing\b|\bunit\b|\bunits\b|duplex|townhouse|condo|single[- ]family|\bsfd\b)/i;
const DEFAULT_MARKET_LAND_PER_DOOR = 100000;
const DEFAULT_UNIT_MIX = { s: 0.25, o: 0.50, t: 0.20, th: 0.05 };

function firstText(...values) {
  for (const value of values) {
    const text = String(value ?? '').trim();
    if (text && text !== '0' && text.toLowerCase() !== 'null') return text;
  }
  return null;
}

function unitsFromText(value) {
  const text = String(value || '');
  const match = text.match(/(\d[\d,]*)\s*[- ]?\s*(?:unit|dwelling|apartment)/i);
  return match ? parseInt(match[1].replace(/,/g, ''), 10) || 0 : 0;
}

function excludedProject(...values) {
  return values.some(value => EXCLUDED_PROJECT_TEXT.test(String(value || '')));
}

function residentialProject(units, ...values) {
  return Number(units || 0) > 0 || values.some(value => RESIDENTIAL_PROJECT_TEXT.test(String(value || '')));
}

function normalizeUnitMix(mix = {}) {
  const values = {
    s: Number(mix.s ?? mix.studio ?? 0),
    o: Number(mix.o ?? mix.one ?? 0),
    t: Number(mix.t ?? mix.two ?? 0),
    th: Number(mix.th ?? mix.three ?? 0),
  };
  const sum = values.s + values.o + values.t + values.th;
  if (!Number.isFinite(sum) || sum <= 0) return { ...DEFAULT_UNIT_MIX };
  return { s: values.s / sum, o: values.o / sum, t: values.t / sum, th: values.th / sum };
}

function addUnitMixMatches(text, key, patterns, counts) {
  for (const pattern of patterns) {
    for (const match of text.matchAll(pattern)) {
      const value = Number(String(match[1] || '').replace(/,/g, ''));
      if (Number.isFinite(value) && value > 0) counts[key] += value;
    }
  }
}

function parseUnitMixFromText(...values) {
  const text = values.map(value => String(value || '').toLowerCase()).join(' ');
  if (!text.trim()) return null;
  const counts = { s: 0, o: 0, t: 0, th: 0 };
  addUnitMixMatches(text, 's', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:studio|studios|efficiency|efficiencies|bachelor|bachelors|sro|sros)\b/g,
    /(?:studio|studios|efficiency|efficiencies|bachelor|bachelors|sro|sros)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  addUnitMixMatches(text, 'o', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:1|one)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(\d[\d,]*)\s*(?:dwelling\s*)?units?\s*(?:of|as)?\s*(?:1|one)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(?:1|one)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  addUnitMixMatches(text, 't', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:2|two)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(\d[\d,]*)\s*(?:dwelling\s*)?units?\s*(?:of|as)?\s*(?:2|two)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(?:2|two)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  addUnitMixMatches(text, 'th', [
    /(\d[\d,]*)\s*(?:x\s*)?(?:3|three)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(\d[\d,]*)\s*(?:dwelling\s*)?units?\s*(?:of|as)?\s*(?:3|three)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\b/g,
    /(?:3|three)[-\s]?(?:bed|beds|bedroom|bedrooms|br|bd|bdrm|bdrms)\s*[:=\-]?\s*(\d[\d,]*)\b/g,
  ], counts);
  const parsedTotal = counts.s + counts.o + counts.t + counts.th;
  return parsedTotal > 0 ? { counts, mix: normalizeUnitMix(counts), parsedTotal } : null;
}

function unitMixForPermit(p, type) {
  if (type === 'New House') {
    return { mix: { s: 0, o: 0, t: 0, th: 1 }, counts: null, parsedTotal: 0, source: 'New house assumption' };
  }
  const parsed = parseUnitMixFromText(p.work_description, p.use_desc, p.permit_type, p.permit_subtype);
  if (parsed) return { ...parsed, source: 'Parsed from permit text' };
  return { mix: { ...DEFAULT_UNIT_MIX }, counts: null, parsedTotal: 0, source: 'Default market mix' };
}

function ownerInfoForPermit(p = {}) {
  const ownerName = firstText(
    p.owner_name,
    p.ownerName,
    p.owner,
    p.ownername,
    p.property_owner,
    p.first_owner_name,
    p.First_Owner_Name,
    p.firstOwnerName
  );
  const applicantName = firstText(
    p.applicant_name,
    p.applicantName,
    p.applicant,
    p.contact_name,
    p.contractor_name
  );
  const mailingAddress = firstText(
    p.owner_mailing_address,
    p.mailing_address,
    p.mail_address,
    p.owner_address
  );
  const apn = firstText(p.apn, p.ain, p.AIN, p.parcel_number);
  if (!ownerName && !applicantName && !mailingAddress && !apn) return null;
  return {
    owner_name: ownerName || applicantName || null,
    applicant_name: applicantName,
    owner_mailing_address: mailingAddress,
    apn,
    source: 'Permit/source record',
  };
}

function addressAliasesForPermit(p) {
  const addr = String(p.address || '').toUpperCase();
  const desc = String(p.work_description || '').toUpperCase();
  if (addr === '6091 W PICO BLVD' && desc.includes('138 UNITS') && desc.includes('110,620')) {
    return [
      '6075 W PICO BLVD',
      '6077 W PICO BLVD',
      '6079 W PICO BLVD',
      '6081 W PICO BLVD',
      '6083 W PICO BLVD',
      '6085 W PICO BLVD',
      '6087 W PICO BLVD',
      '6089 W PICO BLVD',
      '6091 W PICO BLVD',
      '6093 W PICO BLVD',
      '6095 W PICO BLVD',
      '6097 W PICO BLVD',
      '6099 W PICO BLVD',
    ];
  }
  return [];
}

function ptype(pt, st, u, desc = '') {
  const s = [st, desc].filter(Boolean).join(' ').toLowerCase();
  if (s.includes('adu')||s.includes('accessory')||/\baddition\b/.test(s)) return null;
  if (s.includes('condo')||s.includes('townhouse')) return 'Condo/TH';
  if (s.includes('commercial')||s.includes('mixed')) return residentialProject(u, st, desc) ? 'Mixed-Use' : null;
  if (s.includes('single')||(s.includes('1 or 2')&&u<=1)||u===1) return 'New House';
  if (u>=5) return 'Multifamily';
  if (u>=2) return 'Multifamily';
  return 'Multifamily';
}

function developmentStatus(status, isRti) {
  const s = String(status || '').toLowerCase();
  if (s.includes('not ready')) return 'plan_check';
  if (isRti || s.includes('ready') || s.includes('approved')) return 'city_approved_not_started';
  if (s.includes('submit') || s.includes('pc assigned') || s.includes('pc in progress') || s.includes('pc info complete') || s.includes('correction') || s.includes('verification') || s.includes('quality review') || s.includes('reviewed by supervisor')) return 'submitted';
  if (s.includes('plan') || s.includes('pc ') || s.includes('pc_') || s.includes('correction') || s.includes('verification') || s.includes('review') || s.includes('hold')) return 'plan_check';
  if (s.includes('issued')) return 'permit_issued';
  if (s.includes('final') || s.includes('certificate') || s.includes('inspection')) return 'possibly_started_unknown';
  return 'possibly_started_unknown';
}

function irr(cfs) {
  let r=0.15;
  for(let i=0;i<60;i++){
    let n=0,d=0;
    for(let t=0;t<cfs.length;t++){n+=cfs[t]/Math.pow(1+r,t);d-=t*cfs[t]/Math.pow(1+r,t+1);}
    const delta=n/d; r-=delta;
    if(Math.abs(delta)<0.00001)break;
  }
  return Math.round(r*1000)/10;
}

function uw(p) {
  const h = hood(p.lat, p.lng, p.address);
  // Get actual unit count from multiple sources
  const rawUnits = parseInt(p['of_residential_dwelling_units'] || p['number_of_units'] || p.du_changed || '0') || unitsFromText(p.work_description);
  const actualUnits = rawUnits > 0 ? rawUnits : (p.units > 0 ? p.units : 0);
  // Skip ADUs and additions — not development opportunities
  const subtype = (p.permit_subtype || '').toLowerCase();
  if (subtype.includes('adu') || subtype.includes('accessory') || subtype.includes('addition')) return null;
  if (/standard plan way/i.test(String(p.address || ''))) return null;
  if (p.adu_changed || p.junior_adu || excludedProject(p.permit_subtype, p.use_desc, p.work_description)) return null;

  const t = ptype(p.permit_type, p.permit_subtype, actualUnits, p.work_description);
  if (!t) return null;
  const devStatus = developmentStatus(p.status, p.is_rti);
  // Estimate units from valuation if not available
  const costPerUnit = t==='Condo/TH'?272000:t==='Mixed-Use'?256000:t==='New House'?220000:228000;
  const estimatedUnits = Math.max(Math.round((p.valuation||228000)/costPerUnit), t==='New House' ? 1 : 2);
  const u = t==='New House' ? 1 : (actualUnits > 0 ? actualUnits : Math.max(estimatedUnits, 2));
  const R = RENTS[h]||RENTS['Koreatown'];
  const cap = CAPS[h]||0.0525;
  const hc = HC[t]||285;
  const unitMix = unitMixForPermit(p, t);
  const ownerInfo = ownerInfoForPermit(p);
  const blend = R.s*unitMix.mix.s+R.o*unitMix.mix.o+R.t*unitMix.mix.t+R.th*unitMix.mix.th;
  const grossRent = blend*12*u;
  const otherIncome = u*600;
  const egi = grossRent*0.95 + otherIncome;
  const noi = egi*0.65;
  const totalSF = 800*u;
  const hard = hc*totalSF;
  const soft = hard*0.18;
  const fallbackLand = p.valuation>hard ? p.valuation : hard*0.45;
  const compLand = estimateLandBasisFromComps({
    neighborhood:h, project_type:t, units:u, avg_unit_sf:800, lot_sf:5000,
    totalSF, lat:p.lat, lng:p.lng,
  }, LAND_BENCHMARKS);
  const doorLand = ['Multifamily','Mixed-Use'].includes(t)
    ? u * DEFAULT_MARKET_LAND_PER_DOOR
    : 0;
  const land = doorLand || compLand?.value || fallbackLand;
  const pre = land+hard+soft;
  const loan = pre*0.65;
  const carry = loan*0.065*1.5;
  const total = pre+carry;
  const year5Noi = noi*Math.pow(1.03,4);
  const exit = year5Noi/(cap+0.0025);
  const profit = exit-total;
  const eq = total-loan;
  const ds = loan*0.065;
  const cf = noi-ds;
  const irrV = eq>500 ? Math.min(Math.max(irr([-eq,cf,cf,cf,cf,cf+exit-loan]),-50),100) : 0;
  return {
    neighborhood:h, project_type:t, units:u, estimated_units:(p.units===0||!p.units), avg_unit_sf:800, lot_sf:5000,
    price:Math.round(land),
    status:'off-market', data_source:'ladbs_permit', rti:p.is_rti||false,
    lat:p.lat, lng:p.lng,
    raw_permit_data:{
      permit_status:p.status||null,
      development_status:devStatus,
      permit_number:p.permit_number||null,
      work_description:p.work_description||null,
      address_aliases:addressAliasesForPermit(p),
      unit_mix:unitMix.mix,
      unit_mix_counts:unitMix.counts,
      unit_mix_source:unitMix.source,
      unit_mix_parsed_total:unitMix.parsedTotal,
      owner_info:ownerInfo,
      land_value_source:doorLand ? 'default_market_per_door' : (compLand?.source || 'permit_valuation_fallback'),
      land_value_metric:doorLand ? 'price per door' : (compLand?.metricLabel || (p.valuation>hard ? 'permit valuation' : 'hard cost percentage fallback')),
      land_value_metric_value:doorLand ? DEFAULT_MARKET_LAND_PER_DOOR : (compLand?.metricValue ? Math.round(compLand.metricValue) : null),
      land_value_basis_quantity:doorLand ? u : (compLand?.basisQuantity ? Math.round(compLand.basisQuantity) : null),
      land_value_comp_count:doorLand ? 0 : (compLand?.compCount || 0),
      land_value_match:doorLand ? 'market-rate default' : (compLand?.matchLabel || null),
      land_value_recency_days:doorLand ? LAND_COMP_RECENCY_DAYS : (compLand?.recencyDays || LAND_COMP_RECENCY_DAYS),
      land_value_comps:doorLand ? [] : (compLand?.comps || []),
    },
    noi:Math.round(noi), total_cost:Math.round(total), exit_value:Math.round(exit),
    net_profit:Math.round(profit), irr_v:irrV,
    cap_on_cost:Math.round(noi/total*10000)/100,
    dev_spread_pct:Math.round(profit/total*10000)/100,
    permit_source_id:String(p.id),
    underwritten_at:new Date().toISOString(),
  };
}

async function main() {
  const landValue = await import('../../src/data/landValue.js');
  estimateLandBasisFromComps = landValue.estimateLandBasisFromComps;
  LAND_COMP_RECENCY_DAYS = landValue.LAND_COMP_RECENCY_DAYS || LAND_COMP_RECENCY_DAYS;

  const recentSoldComps = await loadRecentSoldComps(LAND_COMP_RECENCY_DAYS);
  LAND_BENCHMARKS = landValue.buildLandCompBenchmarks(recentSoldComps, { recencyDays: LAND_COMP_RECENCY_DAYS });
  console.log(`Loaded ${recentSoldComps.length} recent sold comp(s) for land value benchmarks.`);

  // Load permits in pages
  console.log('Loading permits...');
  let all=[], off=0;
  while(true) {
    const path = `/rest/v1/permits?select=id,permit_number,address,zone,units,valuation,is_rti,status,permit_type,permit_subtype,work_description,lat,lng,raw_data->>of_residential_dwelling_units,raw_data->>number_of_units,raw_data->>du_changed,raw_data->>adu_changed,raw_data->>junior_adu,raw_data->>use_desc,raw_data->>owner_name,raw_data->>ownerName,raw_data->>owner,raw_data->>ownername,raw_data->>property_owner,raw_data->>first_owner_name,raw_data->>applicant_name,raw_data->>applicantName,raw_data->>applicant,raw_data->>contact_name,raw_data->>contractor_name,raw_data->>owner_mailing_address,raw_data->>mailing_address,raw_data->>mail_address,raw_data->>owner_address,raw_data->>apn,raw_data->>ain,raw_data->>parcel_number&limit=1000&offset=${off}&order=id.asc`;
    const r = await req('GET', path);
    console.log('GET permits offset', off, '-> status:', r.status, 'count:', Array.isArray(r.data) ? r.data.length : 'NOT ARRAY', typeof r.data === 'string' ? r.data.slice(0,100) : '');
    if(!Array.isArray(r.data)||!r.data.length) break;
    all=all.concat(r.data);
    console.log('Loaded',all.length,'permits so far');
    if(r.data.length<1000) break;
    off+=1000;
    await sleep(200);
  }
  console.log('Total to underwrite:',all.length);

  // Underwrite in batches. ADUs/additions are deliberately skipped by uw().
  let done=0, skipped=0, failed=0;
  const seen=new Set();
  for(let i=0;i<all.length;i+=50) {
    const batch=all.slice(i,i+50);
    const rows=batch.map(p=>{
      const model = uw(p);
      if (!model) {
        skipped++;
        return null;
      }
      return {address:p.address,...model};
    }).filter(r=>{
      if(!r || !r.address || seen.has(r.permit_source_id)) return false;
      seen.add(r.permit_source_id); return true;
    });
    if (!rows.length) {
      if(i%500===0) console.log('Progress:',i,'/',all.length,'stored:',done,'skipped:',skipped);
      continue;
    }
    const r=await req('POST','/rest/v1/sites?on_conflict=permit_source_id',rows);
    if(r.status<300) done+=rows.length;
    else {
      failed += rows.length;
      console.error('Batch failed:',r.status,JSON.stringify(r.data).slice(0,500));
    }
    if(i%500===0) console.log('Progress:',i,'/',all.length,'stored:',done,'skipped:',skipped,'failed:',failed);
    await sleep(100);
  }
  if (failed) throw new Error(`Underwriting failed for ${failed} row(s)`);
  console.log('DONE. Sites stored:',done,'skipped:',skipped);
}

main().catch(e=>{console.error('FATAL:',e.message);process.exit(1);});
