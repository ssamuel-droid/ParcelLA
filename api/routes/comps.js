/**
 * ParceLLA - Comps Router
 * GET /api/comps                      - list sold comps with filters
 * GET /api/comps/submarket/:hood      - neighborhood sold comp summary
 * GET /api/comps/rent/submarket/:hood - property-level rent comps
 * GET /api/comps/:id                  - single sold comp
 * POST /api/comps                     - add comp (auth required)
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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

function asNumber(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function distanceMiles(lat1, lng1, lat2, lng2) {
  const a = asNumber(lat1);
  const b = asNumber(lng1);
  const c = asNumber(lat2);
  const d = asNumber(lng2);
  if ([a, b, c, d].some(v => v === null)) return null;
  const R = 3958.8;
  const toRad = deg => deg * Math.PI / 180;
  const dLat = toRad(c - a);
  const dLng = toRad(d - b);
  const x = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a)) * Math.cos(toRad(c)) * Math.sin(dLng / 2) ** 2;
  return Math.round((R * 2 * Math.atan2(Math.sqrt(x), Math.sqrt(1 - x))) * 100) / 100;
}

function summarizeAmenities(value) {
  if (!value) return '';
  if (Array.isArray(value)) return value.filter(Boolean).slice(0, 8).join(', ');
  if (typeof value === 'string') return value;
  if (typeof value === 'object') {
    return Object.entries(value)
      .filter(([, v]) => v === true || v === 'true' || typeof v === 'number' || typeof v === 'string')
      .map(([k, v]) => typeof v === 'boolean' || v === 'true' ? k : k + ': ' + v)
      .slice(0, 8)
      .join(', ');
  }
  return String(value);
}

function extractYearBuilt(notes) {
  const match = String(notes || '').match(/\b(18|19|20)\d{2}s?\b/);
  return match ? parseInt(match[0], 10) : null;
}

function mapSoldComp(d, siteLat, siteLng) {
  return {
    id:           d.id,
    address:      d.address,
    neighborhood: d.neighborhood,
    zip:          d.zip,
    lat:          d.lat,
    lng:          d.lng,
    distanceMiles: distanceMiles(siteLat, siteLng, d.lat, d.lng),
    projectType:  d.project_type,
    units:        d.units,
    avgUnitSf:    d.avg_unit_sf,
    yearBuilt:    d.year_built ?? extractYearBuilt(d.notes),
    amenities:    summarizeAmenities(d.amenities) || d.notes || '',
    saleDate:     d.sale_date,
    salePrice:    d.sale_price,
    capRate:      d.cap_rate,
    noi:          d.noi,
    pricePerUnit: d.price_per_unit,
    pricePerSf:   d.price_per_sf,
    buyer:        d.buyer,
    seller:       d.seller,
    source:       d.source,
    notes:        d.notes,
  };
}

function mapRentcastListing(r, siteLat, siteLng) {
  const lat = r.latitude ?? r.lat;
  const lng = r.longitude ?? r.lng;
  const address = r.formattedAddress || [r.addressLine1, r.city, r.state, r.zipCode].filter(Boolean).join(', ');
  const bedrooms = r.bedrooms ?? r.beds;
  const bathrooms = r.bathrooms ?? r.baths;
  const rent = r.price ?? r.rent ?? r.monthlyRent;
  const sf = r.squareFootage ?? r.livingArea ?? r.unit_sf;
  return {
    source:       'rentcast',
    propertyName: r.propertyName || r.name || '',
    address,
    neighborhood: r.neighborhood || '',
    zip:          r.zipCode || r.zip,
    lat,
    lng,
    distanceMiles: distanceMiles(siteLat, siteLng, lat, lng),
    bedroomType: bedrooms === 0 ? 'studio' : bedrooms ? String(bedrooms) + ' BR' : '',
    bedrooms,
    bathrooms,
    monthlyRent: rent,
    unitSf:      sf,
    rentPerSf:   rent && sf ? Math.round((rent / sf) * 100) / 100 : null,
    yearBuilt:   r.yearBuilt,
    propertyUnits: r.units ?? r.propertyUnits ?? r.numberOfUnits,
    amenities:   summarizeAmenities(r.amenities || r.features),
    period:      r.listedDate || r.lastSeenDate || r.createdDate || '',
    url:         r.url || r.listingUrl || '',
  };
}

function mapStoredRentComp(d, siteLat, siteLng) {
  const lat = d.lat;
  const lng = d.lng;
  const rent = d.monthly_rent ?? d.monthlyRent;
  const sf = d.avg_unit_sf ?? d.unit_sf ?? d.square_footage;
  return {
    source:       d.source || 'database',
    propertyName: d.property_name || d.propertyName || '',
    address:      d.address || d.property_address || '',
    neighborhood: d.neighborhood,
    zip:          d.zip,
    lat,
    lng,
    distanceMiles: distanceMiles(siteLat, siteLng, lat, lng),
    bedroomType:  d.bedroom_type || d.bedroomType || '',
    bedrooms:     d.bedrooms,
    bathrooms:    d.bathrooms,
    monthlyRent:  rent,
    unitSf:       sf,
    rentPerSf:    rent && sf ? Math.round((rent / sf) * 100) / 100 : null,
    yearBuilt:    d.year_built ?? d.yearBuilt,
    propertyUnits: d.units ?? d.property_units,
    amenities:    summarizeAmenities(d.amenities) || d.notes || '',
    period:       d.period,
    url:          d.property_url || d.url || '',
  };
}

async function fetchRentcastListings({ hood, siteLat, siteLng, bedrooms, limit }) {
  if (!process.env.RENTCAST_API_KEY) return [];

  const params = new URLSearchParams({
    propertyType: 'Apartment',
    status:       'Active',
    limit:        String(limit),
  });
  if (siteLat && siteLng) {
    params.set('latitude', String(siteLat));
    params.set('longitude', String(siteLng));
    params.set('radius', '3');
  } else if (HOOD_ZIPS[hood]) {
    params.set('zipCode', HOOD_ZIPS[hood]);
  }
  if (bedrooms !== undefined && bedrooms !== null && bedrooms !== '') {
    params.set('bedrooms', String(bedrooms));
  }

  try {
    const response = await fetch('https://api.rentcast.io/v1/listings/rental/long-term?' + params, {
      headers: { 'X-Api-Key': process.env.RENTCAST_API_KEY },
    });
    if (!response.ok) return [];
    const payload = await response.json();
    const list = Array.isArray(payload) ? payload : (payload.listings || payload.results || payload.data || []);
    return list.slice(0, limit).map(r => mapRentcastListing(r, siteLat, siteLng));
  } catch (err) {
    console.warn('[comps] RentCast listing lookup failed:', err.message);
    return [];
  }
}

function rentSummary(rows) {
  const latest = {};
  for (const row of rows) {
    const key = row.bedroomType || row.bedroom_type;
    const rent = row.monthlyRent ?? row.monthly_rent;
    if (key && rent && !latest[key]) latest[key] = rent;
  }
  return latest;
}

// GET /api/comps
router.get('/', async (req, res, next) => {
  try {
    const { hood, type, minDate, maxDate, limit = 50, offset = 0 } = req.query;
    let q = sb().from('sold_comps').select('*');
    if (hood)    q = q.eq('neighborhood', hood);
    if (type)    q = q.eq('project_type', type);
    if (minDate) q = q.gte('sale_date', minDate);
    if (maxDate) q = q.lte('sale_date', maxDate);
    q = q.order('sale_date', { ascending: false }).range(+offset, +offset + +limit - 1);
    const { data, error, count } = await q;
    if (error) throw error;
    res.json({ total: count, results: data ?? [] });
  } catch (err) { next(err); }
});

// GET /api/comps/submarket/:hood - cap rate stats + detailed recent comps
router.get('/submarket/:hood', async (req, res, next) => {
  try {
    const hood = decodeURIComponent(req.params.hood);
    const siteLat = asNumber(req.query.siteLat);
    const siteLng = asNumber(req.query.siteLng);
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 10, 1), 25);
    const { data, error } = await sb()
      .from('sold_comps')
      .select('*')
      .eq('neighborhood', hood)
      .gte('sale_date', new Date(Date.now() - 730 * 86400000).toISOString().split('T')[0])
      .order('sale_date', { ascending: false });

    if (error) throw error;
    if (!data?.length) return res.json({ hood, comps: 0, message: 'No recent comps', recentComps: [] });

    const caps    = data.filter(d => d.cap_rate).map(d => +d.cap_rate);
    const ppus    = data.filter(d => d.price_per_unit).map(d => +d.price_per_unit);
    const ppsfs   = data.filter(d => d.price_per_sf).map(d => +d.price_per_sf);
    const sort    = arr => [...arr].sort((a,b) => a-b);
    const median  = arr => { const s = sort(arr); return s[Math.floor(s.length/2)]; };
    const avg     = arr => arr.reduce((a,b) => a+b, 0) / arr.length;

    res.json({
      hood,
      comps: data.length,
      capRate: {
        avg:    caps.length ? Math.round(avg(caps) * 10000) / 10000 : null,
        median: caps.length ? Math.round(median(caps) * 10000) / 10000 : null,
        min:    caps.length ? Math.round(Math.min(...caps) * 10000) / 10000 : null,
        max:    caps.length ? Math.round(Math.max(...caps) * 10000) / 10000 : null,
        count:  caps.length,
      },
      pricePerUnit: {
        avg:    ppus.length ? Math.round(avg(ppus)) : null,
        median: ppus.length ? Math.round(median(ppus)) : null,
        min:    ppus.length ? Math.min(...ppus) : null,
        max:    ppus.length ? Math.max(...ppus) : null,
      },
      pricePerSf: {
        avg:    ppsfs.length ? Math.round(avg(ppsfs)) : null,
        median: ppsfs.length ? Math.round(median(ppsfs)) : null,
      },
      recentComps: data.slice(0, limit).map(d => mapSoldComp(d, siteLat, siteLng)),
    });
  } catch (err) { next(err); }
});

// GET /api/comps/rent/submarket/:hood - property-level rent comps when available
router.get('/rent/submarket/:hood', async (req, res, next) => {
  try {
    const hood = decodeURIComponent(req.params.hood);
    const siteLat = asNumber(req.query.siteLat);
    const siteLng = asNumber(req.query.siteLng);
    const bedrooms = req.query.bedrooms;
    const limit = Math.min(Math.max(parseInt(req.query.limit, 10) || 12, 1), 25);

    const liveComps = await fetchRentcastListings({ hood, siteLat, siteLng, bedrooms, limit });

    const { data, error } = await sb()
      .from('rent_comps')
      .select('*')
      .eq('neighborhood', hood)
      .order('period', { ascending: false })
      .limit(50);
    if (error) throw error;

    const storedComps = (data ?? []).map(d => mapStoredRentComp(d, siteLat, siteLng));
    const propertyComps = [...liveComps, ...storedComps.filter(c => c.address)].slice(0, limit);

    res.json({
      hood,
      source: liveComps.length ? 'rentcast' : 'database',
      comps: propertyComps.length,
      recentComps: propertyComps,
      marketRents: rentSummary(storedComps),
      benchmarkRows: storedComps.filter(c => !c.address).slice(0, 12),
    });
  } catch (err) { next(err); }
});

// GET /api/comps/:id
router.get('/:id', async (req, res, next) => {
  try {
    const { data, error } = await sb()
      .from('sold_comps').select('*').eq('id', +req.params.id).single();
    if (error) return res.status(404).json({ error: 'Comp not found' });
    res.json(data);
  } catch (err) { next(err); }
});

// POST /api/comps - add a new sold comp
router.post('/', requireAuth, async (req, res, next) => {
  try {
    const {
      address, neighborhood, zip, lat, lng,
      project_type, units, avg_unit_sf,
      sale_price, sale_date, cap_rate, noi,
      buyer, seller, source, notes,
    } = req.body;

    if (!address || !sale_price || !sale_date) {
      return res.status(400).json({ error: 'address, sale_price, and sale_date required' });
    }

    const price_per_unit = units ? Math.round(sale_price / units) : null;
    const price_per_sf   = units && avg_unit_sf
      ? Math.round(sale_price / (units * avg_unit_sf)) : null;

    const { data, error } = await sb()
      .from('sold_comps')
      .insert({
        address, neighborhood, zip, lat, lng,
        project_type, units, avg_unit_sf,
        sale_price, sale_date, cap_rate, noi,
        price_per_unit, price_per_sf,
        buyer, seller, source: source ?? 'manual', notes,
      })
      .select().single();

    if (error) throw error;
    res.status(201).json(data);
  } catch (err) { next(err); }
});

export default router;
