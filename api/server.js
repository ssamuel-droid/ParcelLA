/**
 * ParceLLA API Server
 * Node.js / Express backend
 *
 * npm install express cors dotenv
 * node api/server.js
 */

import express from 'express';
import cors from 'cors';
import dotenv from 'dotenv';

dotenv.config();

const app  = express();
const PORT = process.env.PORT ?? 3001;

app.use(cors());
app.use(express.json());

// ── In-memory store (replace with PostgreSQL) ──────────────────────────────
import { SITES } from '../src/data/sites.js';

// ── Routes ─────────────────────────────────────────────────────────────────

// GET /api/sites — list with optional filters
app.get('/api/sites', (req, res) => {
  const { type, hood, zone, rti, minIRR, maxPrice, minUnits } = req.query;
  let results = [...SITES];

  if (type)     results = results.filter(s => s.type === type);
  if (hood)     results = results.filter(s => s.hood === hood);
  if (zone)     results = results.filter(s => s.zone === zone);
  if (rti)      results = results.filter(s => s.rti  === (rti === 'true'));
  if (maxPrice) results = results.filter(s => s.price <= +maxPrice);
  if (minUnits) results = results.filter(s => s.units >= +minUnits);

  res.json({ count: results.length, results });
});

// GET /api/sites/:id — single site with full model
app.get('/api/sites/:id', (req, res) => {
  const site = SITES.find(s => s.id === +req.params.id);
  if (!site) return res.status(404).json({ error: 'Site not found' });
  res.json(site);
});

// POST /api/model — run financial model with custom overrides
app.post('/api/model', (req, res) => {
  const { siteId, overrides = {} } = req.body;
  const site = SITES.find(s => s.id === siteId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  // Dynamic import to keep server startup fast
  import('../src/model/financialModel.js').then(({ runModel }) => {
    const result = runModel(site, overrides);
    res.json(result);
  });
});

// POST /api/model/scenarios — bear/base/bull
app.post('/api/model/scenarios', (req, res) => {
  const { siteId, overrides = {} } = req.body;
  const site = SITES.find(s => s.id === siteId);
  if (!site) return res.status(404).json({ error: 'Site not found' });

  import('../src/model/financialModel.js').then(({ runScenarios }) => {
    res.json(runScenarios(site, overrides));
  });
});

// GET /api/submarkets — cap rates + rent comps
app.get('/api/submarkets', (req, res) => {
  import('../src/data/submarkets.js').then(({ RENTS, CAP_RATES }) => {
    res.json({ rents: RENTS, capRates: CAP_RATES });
  });
});

// POST /api/alerts — save a deal alert (stub — wire to DB + email)
const alerts = [];
app.post('/api/alerts', (req, res) => {
  const { userId, name, filters, frequency } = req.body;
  const alert = { id: Date.now(), userId, name, filters, frequency, createdAt: new Date() };
  alerts.push(alert);
  res.status(201).json(alert);
});

app.get('/api/alerts/:userId', (req, res) => {
  res.json(alerts.filter(a => a.userId === req.params.userId));
});

// Health check
app.get('/api/health', (req, res) => {
  res.json({ status: 'ok', version: '1.0.0', sites: SITES.length });
});

app.listen(PORT, () => {
  console.log(`ParceLLA API running on http://localhost:${PORT}`);
});

export default app;
