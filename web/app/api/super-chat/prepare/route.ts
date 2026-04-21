import { NextResponse } from 'next/server';
import { getAddress, type Hex } from 'viem';
import { SUPER_CHAT_MAX_CHARS, SuperChatTier } from '@gleamers/shared';

import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { moderate } from '@/lib/chat/moderation';
import { checkBlocklist } from '@/lib/chat/blocklist';
import { isTokenLive } from '@/lib/token-balance';
import {
  paymentsAddress,
  readTierAmounts,
} from '@/lib/super-chat/chain';
import { buildMessageHash, streamerIdToBytes32 } from '@/lib/super-chat/ids';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  slug?: string;
  tier?: number;
  message?: string;
}

function isValidTier(tier: unknown): tier is 1 | 2 | 3 {
  return tier === 1 || tier === 2 || tier === 3;
}

export async function POST(req: Request) {
  if (!isTokenLive()) {
    return NextResponse.json(
      { error: 'token_not_live' },
      { status: 503 },
    );
  }

  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const { slug, tier, message } = body;
  if (!slug || typeof slug !== 'string') {
    return NextResponse.json({ error: 'missing_slug' }, { status: 400 });
  }
  if (!isValidTier(tier)) {
    return NextResponse.json({ error: 'invalid_tier' }, { status: 400 });
  }
  const trimmed = message?.trim() ?? '';
  if (!trimmed) {
    return NextResponse.json({ error: 'missing_message' }, { status: 400 });
  }
  if (trimmed.length > SUPER_CHAT_MAX_CHARS) {
    return NextResponse.json(
      { error: 'message_too_long', maxLength: SUPER_CHAT_MAX_CHARS },
      { status: 400 },
    );
  }

  // Super chat requires a wallet — anonymous users can't fund it.
  const session = await readSession();
  if (!session) {
    return NextResponse.json(
      { error: 'wallet_required' },
      { status: 401 },
    );
  }

  const sb = createSupabaseAdmin();
  const { data: streamer, error: strErr } = await sb
    .from('streamers')
    .select('id, owner_wallet, status, current_session_id')
    .eq('slug', slug)
    .maybeSingle();
  if (strErr) {
    return NextResponse.json(
      { error: 'db_error', detail: strErr.message },
      { status: 500 },
    );
  }
  if (!streamer) {
    return NextResponse.json({ error: 'streamer_not_found' }, { status: 404 });
  }
  if (streamer.status !== 'LIVE' || !streamer.current_session_id) {
    return NextResponse.json({ error: 'session_not_live' }, { status: 409 });
  }

  // Moderate BEFORE committing gas. On hit, log and return 400 — the
  // user shouldn't pay for a message that won't be addressed. Run the
  // local blocklist first so obvious hits skip the OpenAI round-trip.
  const block = await checkBlocklist(trimmed);
  if (block.blocked) {
    await sb.from('moderation_events').insert({
      event_type: 'super_chat_blocked',
      session_id: streamer.current_session_id,
      user_id: session.userId,
      content_snippet: trimmed.slice(0, 200),
      reason: block.reason,
    });
    return NextResponse.json(
      { error: 'moderation_blocked' },
      { status: 400 },
    );
  }

  const mod = await moderate(trimmed);
  if (mod.flagged) {
    await sb.from('moderation_events').insert({
      event_type: 'super_chat_blocked',
      session_id: streamer.current_session_id,
      user_id: session.userId,
      content_snippet: trimmed.slice(0, 200),
      reason: (mod.categories ?? ['flagged']).join(','),
    });
    return NextResponse.json(
      { error: 'moderation_blocked', categories: mod.categories ?? [] },
      { status: 400 },
    );
  }

  // Read live tier amount from the contract.
  let tierAmount: bigint;
  let paymentsAddr: Hex;
  try {
    const amounts = await readTierAmounts();
    tierAmount = amounts[tier];
    paymentsAddr = paymentsAddress();
  } catch (err) {
    return NextResponse.json(
      { error: 'chain_read_failed', detail: String(err) },
      { status: 503 },
    );
  }
  if (tierAmount === 0n) {
    return NextResponse.json(
      { error: 'tier_disabled', tier },
      { status: 503 },
    );
  }

  const timestampMs = Date.now();
  const streamerIdBytes32 = streamerIdToBytes32(streamer.id);
  const streamerOwner = getAddress(streamer.owner_wallet);

  // Insert pending row first so we have the id for the hash.
  const { data: pending, error: pendErr } = await sb
    .from('pending_super_chats')
    .insert({
      streamer_id: streamer.id,
      session_id: streamer.current_session_id,
      user_id: session.userId,
      tier,
      tier_amount: tierAmount.toString(),
      message: trimmed,
      message_hash: '0x', // placeholder, we overwrite below
      streamer_id_bytes32: streamerIdBytes32,
      streamer_owner: streamerOwner,
      status: 'awaiting_tx',
    })
    .select('id')
    .single();
  if (pendErr || !pending) {
    return NextResponse.json(
      { error: 'pending_insert_failed', detail: pendErr?.message ?? 'unknown' },
      { status: 500 },
    );
  }

  const messageHash = buildMessageHash(pending.id, trimmed, timestampMs);
  await sb
    .from('pending_super_chats')
    .update({ message_hash: messageHash })
    .eq('id', pending.id);

  return NextResponse.json({
    pendingId: pending.id,
    tier,
    tierAmount: tierAmount.toString(),
    streamerId: streamer.id,
    streamerIdBytes32,
    streamerOwner,
    messageHash,
    paymentsAddress: paymentsAddr,
    tokenAddress: process.env.NEXT_PUBLIC_TOKEN_ADDRESS ?? null,
    timestampMs,
  });
}
