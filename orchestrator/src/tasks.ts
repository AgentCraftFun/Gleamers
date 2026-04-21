import { COOLDOWN_MS } from '@gleamers/shared';

import { getSupabase } from './supabase.js';
import {
  activeWorkers,
  getWorker,
  removeWorker,
  stopWorker,
} from './workers.js';
import { finalizeSession } from './sessions.js';
import { startStreamerSession } from './startSession.js';

const FORCE_KILL_GRACE_MS = 60_000;

// ---------------------------------------------------------------------------
// Revival config (env-overridable)
// ---------------------------------------------------------------------------

export const REVIVAL_ENABLED = process.env.REVIVAL_ENABLED !== 'false';
export const REVIVAL_MIN_LIVE_THRESHOLD = Number(
  process.env.REVIVAL_MIN_LIVE_THRESHOLD ?? 3,
);
export const REVIVAL_MAX_PER_DAY_PER_STREAMER = Number(
  process.env.REVIVAL_MAX_PER_DAY_PER_STREAMER ?? 1,
);
export const REVIVAL_CHECK_INTERVAL_MS = Number(
  process.env.REVIVAL_CHECK_INTERVAL_MS ?? 300_000,
);

const DAY_MS = 24 * 60 * 60 * 1000;

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

// ---------------------------------------------------------------------------
// Featured revival — every REVIVAL_CHECK_INTERVAL_MS
//
// When fewer than REVIVAL_MIN_LIVE_THRESHOLD streamers are LIVE, promote
// up to `slotsNeeded` longest-idle COOLING_DOWN streamers to revival
// sessions. Their `ready_at` is untouched — it's a platform bonus, not
// a cooldown bypass. Each streamer is capped at
// REVIVAL_MAX_PER_DAY_PER_STREAMER within a rolling 24h window
// (enforced both at candidate-selection time and by the start helper).
// ---------------------------------------------------------------------------

export async function revivalCheck(): Promise<{
  skipped?: string;
  picked: string[];
}> {
  if (!REVIVAL_ENABLED) return { skipped: 'disabled', picked: [] };
  const sb = getSupabase();

  const { count: liveCount, error: cntErr } = await sb
    .from('streamers')
    .select('id', { count: 'exact', head: true })
    .eq('status', 'LIVE');
  if (cntErr) {
    console.warn('[revival] live count failed:', cntErr.message);
    return { skipped: 'db_error', picked: [] };
  }
  const current = liveCount ?? 0;
  if (current >= REVIVAL_MIN_LIVE_THRESHOLD) {
    return { skipped: `threshold_met (${current})`, picked: [] };
  }
  const slots = REVIVAL_MIN_LIVE_THRESHOLD - current;

  const dayAgo = new Date(Date.now() - DAY_MS).toISOString();
  const { data: candidates, error: candErr } = await sb
    .from('streamers')
    .select('*')
    .eq('status', 'COOLING_DOWN')
    .or(
      `revival_count_today.lt.${REVIVAL_MAX_PER_DAY_PER_STREAMER},revival_count_reset_at.lt.${dayAgo},revival_count_reset_at.is.null`,
    )
    .order('last_session_ended_at', { ascending: true, nullsFirst: false })
    .limit(slots);
  if (candErr) {
    console.warn('[revival] candidate query failed:', candErr.message);
    return { skipped: 'db_error', picked: [] };
  }
  if (!candidates || candidates.length === 0) {
    return { skipped: 'no_candidates', picked: [] };
  }

  const picked: string[] = [];
  for (const c of candidates) {
    // Reset the stale counter so the 1-per-24h cap is scoped to the
    // current rolling window. endSession() still bumps the count on
    // session end.
    const resetAt = c.revival_count_reset_at
      ? new Date(c.revival_count_reset_at).getTime()
      : 0;
    if (!resetAt || resetAt < Date.now() - DAY_MS) {
      await sb
        .from('streamers')
        .update({
          revival_count_today: 0,
          revival_count_reset_at: new Date().toISOString(),
        })
        .eq('id', c.id);
    }

    const result = await startStreamerSession(c.slug, 'revival', {
      onExit: (code, signal) =>
        console.log(
          `[orch] revival worker exited: ${c.slug} code=${code} sig=${signal}`,
        ),
    });
    if (result.ok) {
      picked.push(c.slug);
      console.log(
        `[revival] kicked ${c.slug} (sessionId=${result.value.sessionId})`,
      );
    } else {
      console.warn(`[revival] failed ${c.slug}:`, result.error);
    }
  }
  return { picked };
}
