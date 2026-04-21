import { REVENUE_SPLIT } from '@gleamers/shared';
import type { Hex } from 'viem';

import { createSupabaseAdmin } from '@/lib/supabase';
import { buildPersonalityConfig, type DeployFormInput } from './validate';
import { verifyDeployFeeTx } from './chain';
import { orchestratorStartSession } from '@/lib/orchestratorClient';

export interface FinalizeDeployResult {
  ok: boolean;
  status: number;
  body: Record<string, unknown>;
}

/**
 * Shared finaliser for POST /create-confirm and /create-reconcile.
 * Idempotent: if the pending row has already advanced to 'finalized'
 * (streamer row present), short-circuits ok.
 *
 * Order of operations matters for crash safety:
 *  1. verify tx
 *  2. insert streamers  (this is the row users see)
 *  3. insert payment_events (immutable receipt)
 *  4. flip pending_deploys → finalized
 *  5. orchestrator start — failure leaves an OFFLINE streamer the
 *     owner can "Reactivate" later; we do NOT refund (the chain is
 *     already settled).
 */
export async function finalizeDeploy(params: {
  pendingId: string;
  txHash: string;
}): Promise<FinalizeDeployResult> {
  const txHash = params.txHash.toLowerCase() as Hex;
  if (!/^0x[0-9a-f]{64}$/.test(txHash)) {
    return { ok: false, status: 400, body: { error: 'invalid_tx_hash' } };
  }

  const sb = createSupabaseAdmin();
  const { data: pending, error } = await sb
    .from('pending_deploys')
    .select('*')
    .eq('id', params.pendingId)
    .maybeSingle();
  if (error) {
    return {
      ok: false,
      status: 500,
      body: { error: 'db_error', detail: error.message },
    };
  }
  if (!pending) {
    return { ok: false, status: 404, body: { error: 'pending_not_found' } };
  }
  if (pending.status === 'finalized' && pending.streamer_id) {
    const { data: streamer } = await sb
      .from('streamers')
      .select('slug')
      .eq('id', pending.streamer_id)
      .maybeSingle();
    return {
      ok: true,
      status: 200,
      body: {
        alreadyFinalized: true,
        slug: streamer?.slug,
      },
    };
  }
  if (pending.status === 'failed') {
    return { ok: false, status: 410, body: { error: 'pending_failed' } };
  }

  // Duplicate tx guard.
  const { data: existing } = await sb
    .from('payment_events')
    .select('id')
    .eq('tx_hash', txHash)
    .maybeSingle();
  if (existing) {
    await sb
      .from('pending_deploys')
      .update({ status: 'failed' })
      .eq('id', params.pendingId);
    return {
      ok: false,
      status: 409,
      body: { error: 'tx_already_consumed' },
    };
  }

  if (!pending.pending_id_bytes32) {
    return {
      ok: false,
      status: 500,
      body: { error: 'pending_id_bytes32_missing' },
    };
  }
  const expectedAmount = BigInt(pending.deploy_fee_amount ?? '0');
  if (expectedAmount === 0n) {
    return {
      ok: false,
      status: 500,
      body: { error: 'deploy_fee_zero' },
    };
  }

  const verified = await verifyDeployFeeTx(txHash, {
    deployIdBytes32: pending.pending_id_bytes32 as Hex,
    expectedAmount,
  });
  if (!verified) {
    await sb
      .from('pending_deploys')
      .update({ status: 'failed', tx_hash: txHash })
      .eq('id', params.pendingId);
    return {
      ok: false,
      status: 400,
      body: { error: 'tx_verification_failed' },
    };
  }

  const rawForm = (pending.personality_config as unknown as {
    raw_form?: DeployFormInput;
  }).raw_form;
  if (!rawForm) {
    return {
      ok: false,
      status: 500,
      body: { error: 'raw_form_missing' },
    };
  }

  // Ensure slug is still available.
  const { data: slugClash } = await sb
    .from('streamers')
    .select('id')
    .eq('slug', pending.proposed_slug)
    .maybeSingle();
  if (slugClash) {
    await sb
      .from('pending_deploys')
      .update({ status: 'failed', tx_hash: txHash })
      .eq('id', params.pendingId);
    return {
      ok: false,
      status: 409,
      body: { error: 'slug_taken_during_tx' },
    };
  }

  // Insert streamer (the visible artifact).
  const personality_config = buildPersonalityConfig(rawForm);
  const { data: streamer, error: strErr } = await sb
    .from('streamers')
    .insert({
      owner_id: pending.user_id,
      owner_wallet: verified.payer.toLowerCase(),
      name: pending.proposed_name,
      slug: pending.proposed_slug,
      personality_config,
      voice_id: pending.voice_id,
      avatar_vrm_url: pending.avatar_vrm_url,
      status: 'OFFLINE',
      deploy_fee_paid: verified.amount.toString(),
      deploy_tx_hash: txHash,
    })
    .select('id, slug')
    .single();
  if (strErr || !streamer) {
    return {
      ok: false,
      status: 500,
      body: { error: 'streamer_insert_failed', detail: strErr?.message },
    };
  }

  // Insert payment_events (immutable receipt).
  const { burnBps, treasuryBps } = REVENUE_SPLIT.deployFee;
  const burnAmount = (verified.amount * BigInt(burnBps)) / 10000n;
  const treasuryAmount = verified.amount - burnAmount;
  const { data: payment, error: payErr } = await sb
    .from('payment_events')
    .insert({
      event_type: 'deploy_fee',
      tx_hash: txHash,
      from_wallet: verified.payer.toLowerCase(),
      amount: verified.amount.toString(),
      streamer_id: streamer.id,
      burn_amount: burnAmount.toString(),
      treasury_amount: treasuryAmount.toString(),
      status: 'confirmed',
      confirmed_at: new Date().toISOString(),
    })
    .select('id')
    .single();
  if (payErr || !payment) {
    // Unlikely, but leave a breadcrumb — don't roll back the streamer
    // since the chain already moved.
    console.warn('[deploy-finalize] payment_events insert failed:', payErr);
  }

  await sb
    .from('pending_deploys')
    .update({
      status: 'finalized',
      tx_hash: txHash,
      streamer_id: streamer.id,
      payment_event_id: payment?.id ?? null,
    })
    .eq('id', params.pendingId);

  // Kick off debut session. Failure leaves OFFLINE — user gets a
  // "Reactivate" button on the dashboard (future prompt).
  const started = await orchestratorStartSession(streamer.slug, 'debut');

  return {
    ok: true,
    status: 200,
    body: {
      slug: streamer.slug,
      streamerId: streamer.id,
      paymentEventId: payment?.id ?? null,
      debutStarted: started.ok,
      orchestratorError: started.ok ? undefined : started.error,
    },
  };
}
