/**
 * ParceLLA — Deal Notes Router
 * GET    /api/notes/:siteId      — get notes for a site (auth)
 * POST   /api/notes/:siteId      — add note (auth)
 * PATCH  /api/notes/:noteId      — edit note (auth)
 * DELETE /api/notes/:noteId      — delete note (auth)
 */

import { Router } from 'express';
import { createClient } from '@supabase/supabase-js';
import { requireAuth } from '../middleware/auth.js';

const router = Router();
function sb() {
  return createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_KEY);
}

// GET /api/notes/:siteId
router.get('/:siteId', requireAuth, async (req, res, next) => {
  try {
    const { data, error } = await sb()
      .from('deal_notes')
      .select('*')
      .match({ user_id: req.user.id, site_id: +req.params.siteId })
      .order('pinned', { ascending: false })
      .order('created_at', { ascending: false });
    if (error) throw error;
    res.json(data ?? []);
  } catch (err) { next(err); }
});

// POST /api/notes/:siteId
router.post('/:siteId', requireAuth, async (req, res, next) => {
  try {
    const { body, pinned = false } = req.body;
    if (!body?.trim()) return res.status(400).json({ error: 'Note body required' });
    const { data, error } = await sb()
      .from('deal_notes')
      .insert({ user_id: req.user.id, site_id: +req.params.siteId, body: body.trim(), pinned })
      .select().single();
    if (error) throw error;

    // Log activity
    await sb().from('activity_log').insert({
      user_id: req.user.id, action: 'add_note', site_id: +req.params.siteId,
    });

    res.status(201).json(data);
  } catch (err) { next(err); }
});

// PATCH /api/notes/:noteId
router.patch('/:noteId', requireAuth, async (req, res, next) => {
  try {
    const { body, pinned } = req.body;
    const patch = { updated_at: new Date().toISOString() };
    if (body !== undefined) patch.body = body.trim();
    if (pinned !== undefined) patch.pinned = pinned;

    const { data, error } = await sb()
      .from('deal_notes')
      .update(patch)
      .match({ id: +req.params.noteId, user_id: req.user.id })
      .select().single();
    if (error) throw error;
    res.json(data);
  } catch (err) { next(err); }
});

// DELETE /api/notes/:noteId
router.delete('/:noteId', requireAuth, async (req, res, next) => {
  try {
    const { error } = await sb()
      .from('deal_notes')
      .delete()
      .match({ id: +req.params.noteId, user_id: req.user.id });
    if (error) throw error;
    res.json({ deleted: true, id: +req.params.noteId });
  } catch (err) { next(err); }
});

export default router;
