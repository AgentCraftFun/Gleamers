import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { orchestratorStartSession } from '@/lib/orchestratorClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Owner-triggered Go Live. Validates:
 *  - wallet session exists
 *  - streamer exists and is owned by the caller
 *  - current status === 'READY'
 * Then asks the orchestrator to start a 'normal' session.
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
    .select('id, owner_id, status')
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
  if (streamer.status !== 'READY') {
    return NextResponse.json(
      { error: 'not_ready', status: streamer.status },
      { status: 409 },
    );
  }

  const started = await orchestratorStartSession(slug, 'normal');
  if (!started.ok) {
    return NextResponse.json(
      { error: 'orchestrator_start_failed', detail: started.error },
      { status: started.status ?? 502 },
    );
  }
  return NextResponse.json({
    ok: true,
    sessionId: started.sessionId,
    endsAt: started.endsAt,
  });
}
