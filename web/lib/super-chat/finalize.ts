import { getAddress, type Hex } from 'viem';
import {
  CHAT_CHANNEL_PREFIX,
  REVENUE_SPLIT,
  SUPER_CHAT_TIERS,
  type ChatPublishEnvelope,
  type SuperChatTier,
} from '@gleamers/shared';

import { createSupabaseAdmin } from '@/lib/supabase';
import { getRedis } from '@/lib/redis';
import { verifySuperChatTx } from './chain';

export interface FinalizeResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Shared finalisation path used by both /submit and /reconcile.
 * Idempotent: if the pending row is already in 'confirmed' state or
 * the payment_event exists, we return ok without re-writing.
 */
export async function finalizeSuperChat(params: {
  pendingId: string;
  txHash: string;
}): Promise<FinalizeResult> {
  const { pendingId } = params;
  const txHashHex = params.txHash.toLowerCase() as Hex;
  if (!/^0x[0-9a-f]{64}$/.test(txHashHex)) {
    return {
      ok: false,
      status: 400,
      body: { error: 'invalid_tx_hash' },
    };
  }

  const sb = createSupabaseAdmin();

  // Fetch pending row.
  const { data: pending, error: pendErr } = await sb
    .from('pending_super_chats')
    .select('*')
    .eq('id', pendingId)
    .maybeSingle();
  if (pendErr) {
    return {
      ok: false,
      status: 500,
      body: { error: 'db_error', detail: pendErr.message },
    };
  }
  if (!pending) {
    return {
      ok: false,
      status: 404,
      body: { error: 'pending_not_found' },
    };
  }

  // Already confirmed → return the existing rows for client UI.
  if (pending.status === 'confirmed' && pending.chat_message_id) {
    return {
      ok: true,
      status: 200,
      body: {
        alreadyConfirmed: true,
        chatMessageId: pending.chat_message_id,
        paymentEventId: pending.payment_event_id,
      },
    };
  }
  if (pending.status === 'failed') {
    return {
      ok: false,
      status: 410,
      body: { error: 'pending_failed' },
    };
  }

  // Reject duplicate tx hashes from other pendings (replay guard).
  const { data: existing } = await sb
    .from('payment_events')
    .select('id, streamer_id')
    .eq('tx_hash', txHashHex)
    .maybeSingle();
  if (existing) {
    await sb
      .from('pending_super_chats')
      .update({ status: 'failed', finalized_at: new Date().toISOString() })
      .eq('id', pendingId);
    return {
      ok: false,
      status: 409,
      body: { error: 'tx_already_consumed' },
    };
  }

  // Verify on-chain.
  const tierAmount = BigInt(pending.tier_amount);
  const tier = pending.tier as SuperChatTier;
  const verified = await verifySuperChatTx(txHashHex, {
    tier,
    tierAmount,
    messageHash: pending.message_hash as Hex,
    streamerIdBytes32: pending.streamer_id_bytes32 as Hex,
    streamerOwner: getAddress(pending.streamer_owner),
  });
  if (!verified) {
    await sb
      .from('pending_super_chats')
      .update({
        status: 'failed',
        finalized_at: new Date().toISOString(),
        tx_hash: txHashHex,
      })
      .eq('id', pendingId);
    return {
      ok: false,
      status: 400,
      body: { error: 'tx_verification_failed' },
    };
  }

  // Compute splits off the verified amount.
  const { streamerOwnerBps, treasuryBps } = REVENUE_SPLIT.superChat;
  const ownerPayout = (tierAmount * BigInt(streamerOwnerBps)) / 10000n;
  const treasuryShare = tierAmount - ownerPayout;

  const now = new Date();
  const pinUntil = new Date(
    now.getTime() + SUPER_CHAT_TIERS[tier].pinnedForSeconds * 1000,
  );

  // 1. Insert the chat_messages row (the visible UX artifact).
  const { data: chatMsg, error: chatErr } = await sb
    .from('chat_messages')
    .insert({
      session_id: pending.session_id,
      user_id: pending.user_id,
      content: pending.message,
      is_super_chat: true,
      super_chat_tier: tier,
      super_chat_amount: tierAmount.toString(),
      super_chat_tx_hash: txHashHex,
      super_chat_verified: true,
      super_chat_pinned_until: pinUntil.toISOString(),
      sender_token_balance: null,
    })
    .select('id, created_at')
    .single();
  if (chatErr || !chatMsg) {
    return {
      ok: false,
      status: 500,
      body: { error: 'chat_insert_failed', detail: chatErr?.message },
    };
  }

  // 2. Insert payment_events (record on-chain receipt).
  const { data: payment, error: payErr } = await sb
    .from('payment_events')
    .insert({
      event_type: 'super_chat',
      tx_hash: txHashHex,
      from_wallet: verified.payer.toLowerCase(),
      amount: tierAmount.toString(),
      streamer_id: pending.streamer_id,
      chat_message_id: chatMsg.id,
      owner_payout: ownerPayout.toString(),
      treasury_share: treasuryShare.toString(),
      status: 'confirmed',
      confirmed_at: now.toISOString(),
    })
    .select('id')
    .single();
  if (payErr || !payment) {
    // Roll back the chat message if payment_events failed — unlikely
    // but keeps the DB consistent.
    await sb.from('chat_messages').delete().eq('id', chatMsg.id);
    return {
      ok: false,
      status: 500,
      body: { error: 'payment_insert_failed', detail: payErr?.message },
    };
  }

  // 3. Roll up totals. These are "soft" updates — failures log but
  //    don't reverse the primary records.
  try {
    const { data: streamerRow } = await sb
      .from('streamers')
      .select('total_super_chat_earnings')
      .eq('id', pending.streamer_id)
      .maybeSingle();
    if (streamerRow) {
      const running = BigInt(streamerRow.total_super_chat_earnings ?? '0');
      await sb
        .from('streamers')
        .update({
          total_super_chat_earnings: (running + ownerPayout).toString(),
        })
        .eq('id', pending.streamer_id);
    }
    const { data: sessionRow } = await sb
      .from('sessions')
      .select('total_super_chats, total_super_chat_revenue')
      .eq('id', pending.session_id)
      .maybeSingle();
    if (sessionRow) {
      const running = BigInt(sessionRow.total_super_chat_revenue ?? '0');
      await sb
        .from('sessions')
        .update({
          total_super_chats: (sessionRow.total_super_chats ?? 0) + 1,
          total_super_chat_revenue: (running + tierAmount).toString(),
        })
        .eq('id', pending.session_id);
    }
  } catch (err) {
    console.warn('[super-chat] rollup failed (non-fatal):', err);
  }

  // 4. Flip pending → confirmed.
  await sb
    .from('pending_super_chats')
    .update({
      status: 'confirmed',
      tx_hash: txHashHex,
      finalized_at: now.toISOString(),
      chat_message_id: chatMsg.id,
      payment_event_id: payment.id,
    })
    .eq('id', pendingId);

  // 5. Publish to worker Redis channel (best-effort).
  const redis = getRedis();
  if (redis) {
    try {
      const envelope: ChatPublishEnvelope = {
        messageId: chatMsg.id,
        sessionId: pending.session_id,
        slug: '', // worker subscribes by slug channel, looked up below
        userId: pending.user_id,
        displayName: verified.payer,
        content: pending.message,
        senderTokenBalance: '0',
        isSuperChat: true,
        superChatTier: tier,
        createdAt: chatMsg.created_at ?? now.toISOString(),
      };
      // Resolve slug via cached pending.streamer_id
      const { data: streamer } = await sb
        .from('streamers')
        .select('slug')
        .eq('id', pending.streamer_id)
        .maybeSingle();
      if (streamer?.slug) {
        envelope.slug = streamer.slug;
        await redis.publish(
          `${CHAT_CHANNEL_PREFIX}${streamer.slug}`,
          JSON.stringify(envelope),
        );
      }
    } catch (err) {
      console.warn('[super-chat] redis publish failed:', err);
    }
  }

  return {
    ok: true,
    status: 200,
    body: {
      chatMessageId: chatMsg.id,
      paymentEventId: payment.id,
      tier,
      ownerPayout: ownerPayout.toString(),
      treasuryShare: treasuryShare.toString(),
      pinnedUntil: pinUntil.toISOString(),
    },
  };
}
