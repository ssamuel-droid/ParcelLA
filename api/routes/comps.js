/**
 * ParceLLA — Sold Comps Router
 * GET  /api/comps              — list sold comps with filters
 * GET  /api/comps/:id          — single comp
 * GET  /api/comps/submarket/:hood — neighborhood cap rate summary
 * POST /api/comps              — add comp (auth required)
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();

function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
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

// GET /api/comps/submarket/:hood — cap rate stats + avg price/unit for a neighborhood
router.get('/submarket/:hood', async (req, res, next) => {
  try {
    const hood = decodeURIComponent(req.params.hood);
    const { data, error } = await sb()
      .from('sold_comps')
      .select('cap_rate, price_per_unit, price_per_sf, sale_date, units, sale_price')
      .eq('neighborhood', hood)
      .gte('sale_date', new Date(Date.now() - 730 * 86400000).toISOString().split('T')[0])
      .order('sale_date', { ascending: false });

    if (error) throw error;
    if (!data?.length) return res.json({ hood, comps: 0, message: 'No recent comps' });

    const caps    = data.filter(d => d.cap_rate).map(d => +d.cap_rate);
    const ppus    = data.filter(d => d.price_per_unit).map(d => +d.price_per_unit);
    const sort    = arr => [...arr].sort((a,b) => a-b);
    const median  = arr => { const s = sort(arr); return s[Math.floor(s.length/2)]; };
    const avg     = arr => arr.reduce((a,b) => a+b, 0) / arr.length;

    res.json({
      hood,
      comps:           data.length,
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
      recentComps: data.slice(0, 5).map(d => ({
        saleDate:     d.sale_date,
        salePrice:    d.sale_price,
        units:        d.units,
        capRate:      d.cap_rate,
        pricePerUnit: d.price_per_unit,
      })),
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

// POST /api/comps — add a new sold comp
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
