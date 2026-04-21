import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { isTokenLive } from '@/lib/token-balance';
import { paymentsAddress } from '@/lib/super-chat/chain';
import { readDeployFeeAmount } from '@/lib/deploy/chain';
import {
  buildPersonalityConfig,
  validateDeployInput,
} from '@/lib/deploy/validate';
import { streamerIdToBytes32 } from '@/lib/super-chat/ids';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function POST(req: Request) {
  if (!isTokenLive()) {
    return NextResponse.json(
      { error: 'token_not_live', message: 'Use /api/streamers/create-admin' },
      { status: 503 },
    );
  }

  const session = await readSession();
  if (!session) {
    return NextResponse.json({ error: 'wallet_required' }, { status: 401 });
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

  let deployFeeAmount: bigint;
  try {
    deployFeeAmount = await readDeployFeeAmount();
  } catch (err) {
    return NextResponse.json(
      { error: 'chain_read_failed', detail: String(err) },
      { status: 503 },
    );
  }
  if (deployFeeAmount === 0n) {
    return NextResponse.json(
      { error: 'deploy_fee_zero_disabled' },
      { status: 503 },
    );
  }

  const personality_config = buildPersonalityConfig(validated.value);
  const { data: pending, error: insErr } = await sb
    .from('pending_deploys')
    .insert({
      user_id: session.userId,
      personality_config,
      voice_id: validated.value.voice_id,
      avatar_vrm_url: validated.value.avatar_vrm_url,
      proposed_name: validated.value.name,
      proposed_slug: validated.slug,
      deploy_fee_amount: deployFeeAmount.toString(),
      pending_id_bytes32: '0x', // overwrite after we have the id
    })
    .select('id')
    .single();
  if (insErr || !pending) {
    return NextResponse.json(
      { error: 'pending_insert_failed', detail: insErr?.message ?? 'unknown' },
      { status: 500 },
    );
  }

  const pendingIdBytes32 = streamerIdToBytes32(pending.id);
  await sb
    .from('pending_deploys')
    .update({ pending_id_bytes32: pendingIdBytes32 })
    .eq('id', pending.id);

  return NextResponse.json({
    pendingId: pending.id,
    pendingIdBytes32,
    deployFeeAmount: deployFeeAmount.toString(),
    paymentsAddress: paymentsAddress(),
    tokenAddress: process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? null,
    slug: validated.slug,
  });
}
