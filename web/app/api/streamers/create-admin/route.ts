import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import {
  buildPersonalityConfig,
  validateDeployInput,
} from '@/lib/deploy/validate';
import { orchestratorStartSession } from '@/lib/orchestratorClient';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

/**
 * Admin-only deploy — no fee, works in both pre-token and post-token
 * modes (convenient for giveaways / ops). The streamer is inserted
 * with deploy_fee_paid=0 and deploy_tx_hash=null.
 */
export async function POST(req: Request) {
  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 });
  }
  if (!session.isAdmin) {
    return NextResponse.json({ error: 'admin_required' }, { status: 403 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const validated = validateDeployInput(body);
  if (!validated.ok) {
    return NextResponse.json({ error: validated.error }, { status: 400 });
  }

  const sb = createSupabaseAdmin();
  const { data: existing } = await sb
    .from('streamers')
    .select('id')
    .eq('slug', validated.slug)
    .maybeSingle();
  if (existing) {
    return NextResponse.json({ error: 'slug_taken' }, { status: 409 });
  }

  const personality_config = buildPersonalityConfig(validated.value);
  const { data: inserted, error: insErr } = await sb
    .from('streamers')
    .insert({
      owner_id: session.userId,
      owner_wallet: session.walletAddress,
      name: validated.value.name,
      slug: validated.slug,
      personality_config,
      voice_id: validated.value.voice_id,
      avatar_vrm_url: validated.value.avatar_vrm_url,
      status: 'OFFLINE',
      deploy_fee_paid: '0',
    })
    .select('id, slug')
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: 'insert_failed', detail: insErr?.message },
      { status: 500 },
    );
  }

  const started = await orchestratorStartSession(inserted.slug, 'debut');
  if (!started.ok) {
    // Streamer exists but debut failed — owner can hit Reactivate.
    return NextResponse.json(
      {
        ok: true,
        slug: inserted.slug,
        debutStarted: false,
        orchestratorError: started.error,
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    slug: inserted.slug,
    debutStarted: true,
    sessionId: started.sessionId,
  });
}
