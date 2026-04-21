import { COOLDOWN_MS } from '@gleamers/shared';

import { getSupabase } from './supabase.js';
import {
  activeWorkers,
  getWorker,
  removeWorker,
  stopWorker,
} from './workers.js';
import { finalizeSession } from './sessions.js';

const FORCE_KILL_GRACE_MS = 60_000;

// ---------------------------------------------------------------------------
// Lifecycle watcher — every 30s
// ---------------------------------------------------------------------------

export async function lifecycleSweep(): Promise<void> {
  const now = Date.now();
  const sb = getSupabase();

  for (const handle of activeWorkers()) {
    // 1. Process dead unexpectedly?
    if (handle.child.exitCode !== null || handle.child.signalCode !== null) {
      console.warn(
        `[orch] worker ${handle.slug} is dead (exit=${handle.child.exitCode} sig=${handle.child.signalCode}) — reconciling as crash`,
      );
      const { data: streamer } = await sb
        .from('streamers')
        .select('*')
        .eq('slug', handle.slug)
        .maybeSingle();
      if (streamer) {
        await finalizeSession({
          sessionId: handle.sessionId,
          endedAt: new Date(),
          endReason: 'crash',
          streamer,
          sessionType: handle.sessionType,
        });
      }
      removeWorker(handle.slug);
      continue;
    }

    // 2. Past scheduled_end_at + grace → force kill.
    if (now > handle.scheduledEndAt.getTime() + FORCE_KILL_GRACE_MS) {
      console.warn(
        `[orch] worker ${handle.slug} past grace (${FORCE_KILL_GRACE_MS}ms) — force killing`,
      );
      await stopWorker(handle, 1000);
      const { data: streamer } = await sb
        .from('streamers')
        .select('*')
        .eq('slug', handle.slug)
        .maybeSingle();
      if (streamer) {
        await finalizeSession({
          sessionId: handle.sessionId,
          endedAt: new Date(),
          endReason: 'crash',
          streamer,
          sessionType: handle.sessionType,
        });
      }
      removeWorker(handle.slug);
    }
  }
}

// ---------------------------------------------------------------------------
// Cooldown resolver — every 60s
// ---------------------------------------------------------------------------

export async function cooldownResolver(): Promise<number> {
  const sb = getSupabase();
  const { data, error } = await sb
    .from('streamers')
    .update({ status: 'READY' })
    .eq('status', 'COOLING_DOWN')
    .lte('ready_at', new Date().toISOString())
    .select('id, slug');
  if (error) {
    console.error('[orch] cooldownResolver failed:', error);
    return 0;
  }
  if (data && data.length > 0) {
    console.log(
      `[orch] cooldown -> READY: ${data.map((r) => r.slug).join(', ')}`,
    );
  }
  return data?.length ?? 0;
}

// ---------------------------------------------------------------------------
// Startup reconciliation
// Runs once at boot. Any streamer marked LIVE that we don't have a
// worker for is an orphan; close its session as crashed and push it
// into cooldown.
// ---------------------------------------------------------------------------

export async function startupReconcile(): Promise<number> {
  const sb = getSupabase();
  const { data: liveRows, error } = await sb
    .from('streamers')
    .select('*')
    .eq('status', 'LIVE');
  if (error) throw error;
  if (!liveRows || liveRows.length === 0) return 0;

  let reconciled = 0;
  for (const streamer of liveRows) {
    if (getWorker(streamer.slug)) continue;

    const sessionId = streamer.current_session_id;
    const now = new Date();

    if (sessionId) {
      // Close open session if any
      const { data: session } = await sb
        .from('sessions')
        .select('session_type, ended_at')
        .eq('id', sessionId)
        .maybeSingle();
      if (session && !session.ended_at) {
        await finalizeSession({
          sessionId,
          endedAt: now,
          endReason: 'crash',
          streamer,
          sessionType:
            (session.session_type as 'debut' | 'normal' | 'revival') ??
            'normal',
        });
      } else {
        // session is already closed but streamer still says LIVE — fix it
        const readyAt = new Date(now.getTime() + COOLDOWN_MS);
        await sb
          .from('streamers')
          .update({
            status: 'COOLING_DOWN',
            current_session_id: null,
            last_session_ended_at: now.toISOString(),
            ready_at: readyAt.toISOString(),
          })
          .eq('id', streamer.id);
      }
    } else {
      const readyAt = new Date(now.getTime() + COOLDOWN_MS);
      await sb
        .from('streamers')
        .update({
          status: 'COOLING_DOWN',
          current_session_id: null,
          last_session_ended_at: now.toISOString(),
          ready_at: readyAt.toISOString(),
        })
        .eq('id', streamer.id);
    }
    reconciled++;
  }
  if (reconciled > 0) {
    console.warn(`[orch] startup reconciled ${reconciled} orphaned streamer(s)`);
  }
  return reconciled;
}
