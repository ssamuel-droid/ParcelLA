/**
 * ParceLLA — Frontend API Client
 *
 * Typed wrapper around all backend routes.
 * Handles auth token injection, error normalization,
 * loading states, and offline fallback to mock data.
 *
 * Usage:
 *   import { api } from './api/client.js';
 *
 *   const { results } = await api.sites.list({ minIRR: 15, hood: 'Silver Lake' });
 *   const { model }   = await api.model.run(1, { exitCap: 5.5 });
 *   const pdf         = await api.pdf.generate(1);
 */

const BASE_URL = import.meta?.env?.VITE_API_URL ?? 'http://localhost:3001';

// ── Auth token store ──────────────────────────────────────────────────────────
let _token = null;
export function setAuthToken(token) { _token = token; }
export function clearAuthToken()    { _token = null; }

// ── Core fetch wrapper ────────────────────────────────────────────────────────
async function apiFetch(path, options = {}) {
  const headers = { 'Content-Type': 'application/json', ...options.headers };
  if (_token) headers['Authorization'] = `Bearer ${_token}`;

  const res = await fetch(`${BASE_URL}${path}`, { ...options, headers });

  // PDF — return raw buffer
  if (options._pdf) {
    if (!res.ok) throw new Error(`PDF generation failed: ${res.status}`);
    return res.blob();
  }

  const data = await res.json().catch(() => ({ error: `HTTP ${res.status}` }));
  if (!res.ok) throw new APIError(data.error ?? `HTTP ${res.status}`, res.status);
  return data;
}

function get(path, params = {})       {
  const qs = new URLSearchParams(Object.entries(params).filter(([,v]) => v !== undefined && v !== null && v !== ''));
  return apiFetch(`${path}${qs.toString() ? '?' + qs : ''}`);
}
function post(path, body = {})        { return apiFetch(path, { method: 'POST',   body: JSON.stringify(body) }); }
function put(path, body = {})         { return apiFetch(path, { method: 'PUT',    body: JSON.stringify(body) }); }
function del(path)                    { return apiFetch(path, { method: 'DELETE' }); }
function postPDF(path, body = {})     { return apiFetch(path, { method: 'POST', body: JSON.stringify(body), _pdf: true }); }

class APIError extends Error {
  constructor(message, status) { super(message); this.status = status; }
}

// ── API surface ───────────────────────────────────────────────────────────────
export const api = {

  // ── Health ──────────────────────────────────────────────────────────────────
  health: {
    check: () => get('/api/health'),
  },

  // ── Sites ───────────────────────────────────────────────────────────────────
  sites: {
    /**
     * List sites with pre-underwriting applied.
     * All params optional — pass only what you want to filter on.
     */
    list: (params = {}) => get('/api/sites', {
      type:      params.type,
      hood:      params.hood,
      zone:      params.zone,
      rti:       params.rti,
      isComp:    params.isComp,
      minUnits:  params.minUnits,
      maxUnits:  params.maxUnits,
      minLot:    params.minLot,
      minPrice:  params.minPrice,
      maxPrice:  params.maxPrice,
      // Metric filters (pre-underwritten)
      minIRR:    params.minIRR,
      minProfit: params.minProfit,
      minSpread: params.minSpread,
      minCapoc:  params.minCapoc,
      // Underwriting overrides applied globally
      exitCap:   params.exitCap,
      hcpsf:     params.hcpsf,
      sc:        params.sc,
      ppu:       params.ppu,
      psf:       params.psf,
      method:    params.method,
      // Sorting + pagination
      sort:      params.sort   ?? 'profit',
      limit:     params.limit  ?? 50,
      offset:    params.offset ?? 0,
    }),

    /** Single site — full model, scenarios, user saved state */
    get: (id, overrideParams = {}) => get(`/api/sites/${id}`, overrideParams),

    /** LADBS + Census enrichment */
    enrich: (id) => get(`/api/sites/${id}/enrich`),

    /** 7-factor demand score */
    demand: (id) => get(`/api/sites/${id}/demand`),

    /** Save to user's watchlist */
    save:   (id, notes = '') => post(`/api/sites/${id}/save`, { notes }),

    /** Remove from watchlist */
    unsave: (id) => del(`/api/sites/${id}/save`),
  },

  // ── Financial model ─────────────────────────────────────────────────────────
  model: {
    /** Run model with custom overrides */
    run: (id, overrides = {}) => post(`/api/model/${id}`, { overrides }),

    /** Bear / base / bull + stress tests */
    scenarios: (id, overrides = {}) => post(`/api/model/${id}/scenarios`, { overrides }),

    /**
     * Equity waterfall
     * preset: 'standard' | 'institutional' | 'irr_hurdles' | 'developer_friendly'
     * compare: true → returns all 4 presets side by side
     */
    waterfall: (id, { overrides = {}, preset = 'institutional', compare = false, options = {} } = {}) =>
      post(`/api/model/${id}/waterfall`, { overrides, preset, compare, options }),

    /** Save user's overrides for a site */
    saveOverrides: (id, overrides) => put(`/api/model/${id}/overrides`, { overrides }),

    /** Get user's saved overrides */
    getOverrides: (id) => get(`/api/model/${id}/overrides`),

    /** List available waterfall presets */
    waterfallPresets: () => get('/api/model/waterfall/presets'),
  },

  // ── PDF ─────────────────────────────────────────────────────────────────────
  pdf: {
    /**
     * Generate deal memo PDF.
     * Returns a Blob — caller should trigger download or open in new tab.
     */
    generate: (id, overrides = {}) => postPDF(`/api/pdf/${id}`, { overrides }),

    /** Helper: trigger browser download */
    download: async (id, addr, overrides = {}) => {
      const blob = await api.pdf.generate(id, overrides);
      const url  = URL.createObjectURL(blob);
      const a    = document.createElement('a');
      a.href     = url;
      a.download = `ParceLLA_${addr.replace(/\s+/g,'_').replace(/[^a-zA-Z0-9_]/g,'')}.pdf`;
      a.click();
      URL.revokeObjectURL(url);
    },
  },

  // ── Auth ────────────────────────────────────────────────────────────────────
  auth: {
    signUp:  (email, password, name) => post('/api/auth/signup',  { email, password, name }),
    signIn:  (email, password)       => post('/api/auth/signin',  { email, password }),
    signOut: ()                       => post('/api/auth/signout', {}),
    me:      ()                       => get('/api/auth/me'),
  },

  // ── Alerts ──────────────────────────────────────────────────────────────────
  alerts: {
    list:   ()                              => get('/api/alerts'),
    create: (name, filters, frequency)      => post('/api/alerts', { name, filters, frequency }),
    delete: (id)                            => del(`/api/alerts/${id}`),
  },

  // ── Submarkets ──────────────────────────────────────────────────────────────
  submarkets: {
    list: ()     => get('/api/submarkets'),
    get:  (hood) => get(`/api/submarkets/${encodeURIComponent(hood)}`),
  },
};

// ── React hook: useParcella ───────────────────────────────────────────────────
// Lightweight hook for use in React components (no external state lib needed)

export function createStore(initialState) {
  let state   = { ...initialState };
  const subs  = new Set();
  const get   = ()      => state;
  const set   = (patch) => { state = { ...state, ...patch }; subs.forEach(fn => fn(state)); };
  const sub   = (fn)    => { subs.add(fn); return () => subs.delete(fn); };
  return { get, set, sub };
}

// Global app store
export const store = createStore({
  sites:       [],
  filtered:    [],
  loading:     false,
  error:       null,
  user:        null,
  savedIds:    new Set(),
  filters:     {},
  globals:     { exitCap: '', hcpsf: 285, sc: 18, ppu: 150000, psf: 185, method: 'ppu' },
  openSiteId:  null,
  siteDetail:  null,
  demandScores:{},
  waterfalls:  {},
  activeView:  'list',   // 'list' | 'map'
  mainView:    'search', // 'search' | 'saved' | 'alerts' | 'data'
});

// ── Action creators ───────────────────────────────────────────────────────────
export const actions = {

  async loadSites(params = {}) {
    store.set({ loading: true, error: null });
    try {
      const data = await api.sites.list(params);
      store.set({ sites: data.results, filtered: data.results, loading: false });
      return data;
    } catch (err) {
      store.set({ loading: false, error: err.message });
      throw err;
    }
  },

  async loadSiteDetail(id) {
    store.set({ loading: true });
    try {
      const { globals } = store.get();
      const data = await api.sites.get(id, { exitCap: globals.exitCap || undefined });
      store.set({ siteDetail: data, openSiteId: id, loading: false });
      return data;
    } catch (err) {
      store.set({ loading: false, error: err.message });
      throw err;
    }
  },

  async loadDemandScore(id) {
    try {
      const demand = await api.sites.demand(id);
      const { demandScores } = store.get();
      store.set({ demandScores: { ...demandScores, [id]: demand } });
      return demand;
    } catch (err) {
      console.warn(`Demand score unavailable for site ${id}:`, err.message);
    }
  },

  async loadWaterfall(id, preset = 'institutional') {
    try {
      const result = await api.model.waterfall(id, { preset, compare: true });
      const { waterfalls } = store.get();
      store.set({ waterfalls: { ...waterfalls, [id]: result.waterfall } });
      return result;
    } catch (err) {
      console.warn(`Waterfall unavailable for site ${id}:`, err.message);
    }
  },

  async saveSite(id) {
    const { user } = store.get();
    if (!user) return false;
    await api.sites.save(id);
    const { savedIds } = store.get();
    const next = new Set(savedIds);
    next.add(id);
    store.set({ savedIds: next });
    return true;
  },

  async unsaveSite(id) {
    await api.sites.unsave(id);
    const { savedIds } = store.get();
    const next = new Set(savedIds);
    next.delete(id);
    store.set({ savedIds: next });
  },

  async signIn(email, password) {
    const data = await api.auth.signIn(email, password);
    setAuthToken(data.session.access_token);
    store.set({ user: data.user });
    // Load saved sites
    const me = await api.auth.me();
    store.set({ savedIds: new Set(me.savedSiteIds) });
    return data;
  },

  async signUp(email, password, name) {
    const data = await api.auth.signUp(email, password, name);
    if (data.session) {
      setAuthToken(data.session.access_token);
      store.set({ user: data.user });
    }
    return data;
  },

  async signOut() {
    await api.auth.signOut();
    clearAuthToken();
    store.set({ user: null, savedIds: new Set() });
  },

  async generatePDF(id, addr, overrides = {}) {
    await api.pdf.download(id, addr, overrides);
  },

  setGlobals(patch) {
    const { globals, filters } = store.get();
    store.set({ globals: { ...globals, ...patch } });
    // Re-run search with updated globals
    actions.loadSites({ ...filters, ...store.get().globals });
  },

  setFilters(patch) {
    const { filters, globals } = store.get();
    const next = { ...filters, ...patch };
    store.set({ filters: next });
    actions.loadSites({ ...next, ...globals });
  },
};

export { APIError };
