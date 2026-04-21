/**
 * Shared helpers for finalising a session in Supabase.
 *
 * Both the /stop route and the lifecycle watcher use these to keep
 * the crash-reconcile path identical to the graceful-stop path.
 */
import type {
  SessionEndReason,
  SessionType,
  StreamerRow,
} from '@gleamers/shared';
import { COOLDOWN_MS } from '@gleamers/shared';

import { getSupabase } from './supabase.js';

export async function finalizeSession(params: {
  sessionId: string;
  endedAt: Date;
  endReason: SessionEndReason;
  streamer: StreamerRow;
  sessionType: SessionType;
}): Promise<void> {
  const { sessionId, endedAt, endReason, streamer, sessionType } = params;
  const sb = getSupabase();

  // 1. Close the session row
  const { error: sessionErr } = await sb
    .from('sessions')
    .update({
      ended_at: endedAt.toISOString(),
      end_reason: endReason,
    })
    .eq('id', sessionId);
  if (sessionErr) {
    console.error('[orch] finalizeSession sessions update failed:', sessionErr);
  }

  // 2. Transition the streamer per session_type
  if (sessionType === 'revival') {
    const now = new Date();
    const resetAt = streamer.revival_count_reset_at
      ? new Date(streamer.revival_count_reset_at)
      : null;
    const needsReset =
      !resetAt || now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000;

    const { error } = await sb
      .from('streamers')
      .update({
        status: 'COOLING_DOWN',
        current_session_id: null,
        last_session_ended_at: endedAt.toISOString(),
        total_sessions: streamer.total_sessions + 1,
        revival_count_today: needsReset ? 1 : streamer.revival_count_today + 1,
        revival_count_reset_at: needsReset
          ? now.toISOString()
          : streamer.revival_count_reset_at,
        // ready_at unchanged on revival (freebie)
      })
      .eq('id', streamer.id);
    if (error)
      console.error('[orch] finalizeSession streamer revival update failed:', error);
  } else {
    const readyAt = new Date(endedAt.getTime() + COOLDOWN_MS);
    const { error } = await sb
      .from('streamers')
      .update({
        status: 'COOLING_DOWN',
        current_session_id: null,
        last_session_ended_at: endedAt.toISOString(),
        ready_at: readyAt.toISOString(),
        total_sessions: streamer.total_sessions + 1,
      })
      .eq('id', streamer.id);
    if (error)
      console.error('[orch] finalizeSession streamer normal update failed:', error);
  }
}
