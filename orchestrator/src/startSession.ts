import { SESSION_LENGTH_MS } from '@gleamers/shared';
import type { SessionType, StreamerStatus } from '@gleamers/shared';

import { getSupabase } from './supabase.js';
import {
  getWorker,
  registerWorker,
  spawnWorker,
  type WorkerHandle,
} from './workers.js';

export const ALLOWED_STATUS_BY_TYPE: Record<SessionType, StreamerStatus> = {
  debut: 'OFFLINE',
  normal: 'READY',
  revival: 'COOLING_DOWN',
};

export type StartSessionError =
  | { kind: 'already_running' }
  | { kind: 'not_found' }
  | { kind: 'status_mismatch'; current: StreamerStatus; expected: StreamerStatus }
  | { kind: 'revival_cap_reached' }
  | { kind: 'db_error'; message: string }
  | { kind: 'spawn_error'; message: string };

export interface StartSessionSuccess {
  handle: WorkerHandle;
  sessionId: string;
  workerPort: number;
  endsAt: Date;
}

export type StartSessionResult =
  | { ok: true; value: StartSessionSuccess }
  | { ok: false; error: StartSessionError };

/**
 * Shared start-session helper used by POST /streamers/:slug/start and
 * by the revival background job. Inserts a sessions row, flips the
 * streamer to LIVE, spawns the worker, and registers the handle. On
 * spawn failure, rolls back the DB writes so the streamer isn't left
 * stuck in LIVE with no worker.
 */
export async function startStreamerSession(
  slug: string,
  sessionType: SessionType,
  opts: { onExit?: (code: number | null, signal: NodeJS.Signals | null) => void } = {},
): Promise<StartSessionResult> {
  if (getWorker(slug)) {
    return { ok: false, error: { kind: 'already_running' } };
  }

  const sb = getSupabase();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select('*')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    return { ok: false, error: { kind: 'db_error', message: error.message } };
  }
  if (!streamer) return { ok: false, error: { kind: 'not_found' } };

  const expected = ALLOWED_STATUS_BY_TYPE[sessionType];
  if (streamer.status !== expected) {
    return {
      ok: false,
      error: {
        kind: 'status_mismatch',
        current: streamer.status,
        expected,
      },
    };
  }

  if (sessionType === 'revival') {
    const resetAt = streamer.revival_count_reset_at
      ? new Date(streamer.revival_count_reset_at)
      : null;
    const within24h =
      resetAt && Date.now() - resetAt.getTime() <= 24 * 60 * 60 * 1000;
    const count = within24h ? streamer.revival_count_today : 0;
    if (count >= 1) {
      return { ok: false, error: { kind: 'revival_cap_reached' } };
    }
  }

  const now = new Date();
  const endsAt = new Date(now.getTime() + SESSION_LENGTH_MS);

  const { data: session, error: sessErr } = await sb
    .from('sessions')
    .insert({
      streamer_id: streamer.id,
      scheduled_end_at: endsAt.toISOString(),
      session_type: sessionType,
    })
    .select('*')
    .single();
  if (sessErr || !session) {
    return {
      ok: false,
      error: { kind: 'db_error', message: sessErr?.message ?? 'session insert' },
    };
  }

  const { error: upErr } = await sb
    .from('streamers')
    .update({
      status: 'LIVE',
      current_session_id: session.id,
      last_active_at: now.toISOString(),
    })
    .eq('id', streamer.id);
  if (upErr) {
    await sb.from('sessions').delete().eq('id', session.id);
    return { ok: false, error: { kind: 'db_error', message: upErr.message } };
  }

  let spawned;
  try {
    spawned = spawnWorker({ slug, sessionId: session.id, sessionType });
  } catch (err) {
    await sb.from('sessions').delete().eq('id', session.id);
    await sb
      .from('streamers')
      .update({
        status: streamer.status,
        current_session_id: null,
      })
      .eq('id', streamer.id);
    return {
      ok: false,
      error: { kind: 'spawn_error', message: String(err) },
    };
  }

  const handle: WorkerHandle = {
    slug,
    sessionId: session.id,
    sessionType,
    port: spawned.port,
    scheduledEndAt: endsAt,
    child: spawned.child,
    startedAt: now,
    viewers: new Set<string>(),
  };
  registerWorker(handle);
  if (opts.onExit) spawned.child.once('exit', opts.onExit);

  return {
    ok: true,
    value: {
      handle,
      sessionId: session.id,
      workerPort: spawned.port,
      endsAt,
    },
  };
}
