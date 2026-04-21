import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { orchestratorStartSession } from '@/lib/orchestratorClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Reactivate an OFFLINE streamer. OFFLINE normally means:
 *  - the debut never started (orchestrator was down at deploy time), or
 *  - the deployer manually parked the streamer.
 *
 * For a never-streamed streamer (total_sessions = 0) we launch with
 * sessionType='debut'; for anything else, 'normal'.
 */
export async function POST(
  _req: Request,
  ctx: { params: { slug: string } },
) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }

  const { slug } = ctx.params;
  const sb = createSupabaseAdmin();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select('id, owner_id, status, total_sessions')
    .eq('slug', slug)
    .maybeSingle();
  if (error) {
    return NextResponse.json(
      { error: 'db_error', detail: error.message },
      { status: 500 },
    );
  }
  if (!streamer) {
    return NextResponse.json({ error: 'not_found' }, { status: 404 });
  }
  if (streamer.owner_id !== session.userId) {
    return NextResponse.json({ error: 'not_owner' }, { status: 403 });
  }
  if (streamer.status !== 'OFFLINE') {
    return NextResponse.json(
      { error: 'not_offline', status: streamer.status },
      { status: 409 },
    );
  }

  const sessionType =
    streamer.total_sessions === 0 ? 'debut' : 'normal';
  if (sessionType === 'normal') {
    // The orchestrator only accepts 'normal' for READY streamers.
    // Flip OFFLINE→READY first so the invariant holds.
    await sb
      .from('streamers')
      .update({ status: 'READY' })
      .eq('id', streamer.id);
  }

  const started = await orchestratorStartSession(slug, sessionType);
  if (!started.ok) {
    return NextResponse.json(
      {
        error: 'orchestrator_start_failed',
        detail: started.error,
        attemptedType: sessionType,
      },
      { status: started.status ?? 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    sessionType,
    sessionId: started.sessionId,
    endsAt: started.endsAt,
  });
}
