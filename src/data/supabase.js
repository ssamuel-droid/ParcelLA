/**
 * ParceLLA — Supabase client
 *
 * npm install @supabase/supabase-js
 *
 * Used for:
 *   - User auth (sign up, sign in, sign out)
 *   - Saved sites (per user)
 *   - Model overrides (per user per site)
 *   - Deal alerts
 *   - Site CRUD
 */

import { createClient } from '@supabase/supabase-js';

const SUPABASE_URL = process.env.SUPABASE_URL  || import.meta?.env?.VITE_SUPABASE_URL;
const SUPABASE_KEY = process.env.SUPABASE_ANON_KEY || import.meta?.env?.VITE_SUPABASE_ANON_KEY;

if (!SUPABASE_URL || !SUPABASE_KEY) {
  throw new Error('Missing SUPABASE_URL or SUPABASE_ANON_KEY — check your .env');
}

export const supabase = createClient(SUPABASE_URL, SUPABASE_KEY);

// ─────────────────────────────────────────────────────────────────────────────
// AUTH
// ─────────────────────────────────────────────────────────────────────────────

export async function signUp(email, password, name) {
  const { data, error } = await supabase.auth.signUp({
    email, password,
    options: { data: { name } },
  });
  if (error) throw error;
  return data;
}

export async function signIn(email, password) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password });
  if (error) throw error;
  return data;
}

export async function signOut() {
  const { error } = await supabase.auth.signOut();
  if (error) throw error;
}

export async function getSession() {
  const { data } = await supabase.auth.getSession();
  return data.session;
}

export function onAuthStateChange(callback) {
  return supabase.auth.onAuthStateChange((event, session) => {
    callback(event, session);
  });
}

// ─────────────────────────────────────────────────────────────────────────────
// SITES
// ─────────────────────────────────────────────────────────────────────────────

export async function getSites(filters = {}) {
  let q = supabase.from('sites').select('*').eq('status', 'active');

  if (filters.rti !== undefined)     q = q.eq('rti', filters.rti);
  if (filters.projectType)           q = q.eq('project_type', filters.projectType);
  if (filters.neighborhood)          q = q.eq('neighborhood', filters.neighborhood);
  if (filters.zoning)                q = q.eq('zoning', filters.zoning);
  if (filters.minPrice)              q = q.gte('price', filters.minPrice);
  if (filters.maxPrice)              q = q.lte('price', filters.maxPrice);
  if (filters.minUnits)              q = q.gte('units', filters.minUnits);
  if (filters.maxUnits)              q = q.lte('units', filters.maxUnits);
  if (filters.minLotSF)              q = q.gte('lot_sf', filters.minLotSF);

  const { data, error } = await q.order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function getSiteById(id) {
  const { data, error } = await supabase
    .from('sites').select('*').eq('id', id).single();
  if (error) throw error;
  return data;
}

// ─────────────────────────────────────────────────────────────────────────────
// SAVED SITES
// ─────────────────────────────────────────────────────────────────────────────

export async function getSavedSites(userId) {
  const { data, error } = await supabase
    .from('saved_sites')
    .select('*, sites(*)')
    .eq('user_id', userId);
  if (error) throw error;
  return data;
}

export async function saveSite(userId, siteId, notes = '') {
  const { error } = await supabase
    .from('saved_sites')
    .upsert({ user_id: userId, site_id: siteId, notes });
  if (error) throw error;
}

export async function unsaveSite(userId, siteId) {
  const { error } = await supabase
    .from('saved_sites')
    .delete()
    .match({ user_id: userId, site_id: siteId });
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// MODEL OVERRIDES
// ─────────────────────────────────────────────────────────────────────────────

export async function getOverrides(userId, siteId) {
  const { data, error } = await supabase
    .from('model_overrides')
    .select('overrides')
    .match({ user_id: userId, site_id: siteId })
    .maybeSingle();
  if (error) throw error;
  return data?.overrides ?? {};
}

export async function saveOverrides(userId, siteId, overrides) {
  const { error } = await supabase
    .from('model_overrides')
    .upsert({ user_id: userId, site_id: siteId, overrides, updated_at: new Date() });
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// DEAL ALERTS
// ─────────────────────────────────────────────────────────────────────────────

export async function getAlerts(userId) {
  const { data, error } = await supabase
    .from('alerts')
    .select('*')
    .eq('user_id', userId)
    .eq('active', true)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return data;
}

export async function createAlert(userId, { name, filters, frequency = 'daily' }) {
  const { data, error } = await supabase
    .from('alerts')
    .insert({ user_id: userId, name, filters, frequency })
    .select()
    .single();
  if (error) throw error;
  return data;
}

export async function deleteAlert(alertId) {
  const { error } = await supabase
    .from('alerts').update({ active: false }).eq('id', alertId);
  if (error) throw error;
}

// ─────────────────────────────────────────────────────────────────────────────
// RENT COMPS
// ─────────────────────────────────────────────────────────────────────────────

export async function getRentComps(neighborhood) {
  const { data, error } = await supabase
    .from('rent_comps')
    .select('bedroom_type, monthly_rent, source, period')
    .eq('neighborhood', neighborhood)
    .order('period', { ascending: false });
  if (error) throw error;

  // Return latest per bedroom type
  const latest = {};
  for (const row of data) {
    if (!latest[row.bedroom_type]) latest[row.bedroom_type] = row.monthly_rent;
  }
  return latest;
}
