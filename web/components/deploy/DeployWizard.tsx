'use client';

import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import { erc20Abi, getAddress, type Address, type Hex } from 'viem';
import {
  useAccount,
  useReadContract,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getChainId } from '@/lib/chain';
import { DEPLOY_FEE_ABI } from '@/lib/deploy/chain';
import { useDeployDraft } from './useDeployDraft';
import { PersonalityStep } from './steps/PersonalityStep';
import { VoiceStep } from './steps/VoiceStep';
import { AvatarStep } from './steps/AvatarStep';
import { ReviewStep } from './steps/ReviewStep';

interface Props {
  tokenLive: boolean;
  isAdmin: boolean;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'approving' }
  | { kind: 'signing_pay' }
  | { kind: 'waiting_receipt'; txHash: Hex; pendingId: string }
  | { kind: 'confirming'; txHash: Hex; pendingId: string }
  | { kind: 'done'; slug: string }
  | { kind: 'error'; message: string; txHash?: Hex; pendingId?: string };

const STEP_LABELS = ['Personality', 'Voice', 'Avatar', 'Review'];

export function DeployWizard({ tokenLive, isAdmin }: Props) {
  const router = useRouter();
  const { step, setStep, form, updateForm, clear, canAdvance, loaded } =
    useDeployDraft();
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });

  const { address, chainId: activeChainId, isConnected } = useAccount();
  const expectedChainId = getChainId();
  const { switchChainAsync } = useSwitchChain();
  const { writeContractAsync } = useWriteContract();
  const { openConnectModal } = useConnectModal();

  const paymentsAddress = process.env.NEXT_PUBLIC_PAYMENTS_ADDRESS;
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;

  // Read current allowance for the fee path.
  const { data: allowance } = useReadContract({
    address: tokenAddress ? getAddress(tokenAddress) : undefined,
    abi: erc20Abi,
    functionName: 'allowance',
    args:
      address && paymentsAddress
        ? [address, getAddress(paymentsAddress)]
        : undefined,
    query: {
      enabled: Boolean(tokenLive && !isAdmin && address && paymentsAddress && tokenAddress),
    },
  });

  const usesFeeFlow = tokenLive && !isAdmin;

  // Tx receipt watcher for the fee flow.
  useWaitForTransactionReceipt({
    hash:
      stage.kind === 'waiting_receipt' ? stage.txHash : undefined,
    query: {
      enabled: stage.kind === 'waiting_receipt',
    },
  });
  // Manual poll: once it's mined, call confirm server-side.
  const receiptStatus = useWaitForTransactionReceipt({
    hash:
      stage.kind === 'waiting_receipt' ? stage.txHash : undefined,
  });

  // Effect-like guard: when receipt is ready, transition to confirming.
  if (
    stage.kind === 'waiting_receipt' &&
    receiptStatus.data &&
    receiptStatus.data.transactionHash
  ) {
    // Defer to a microtask so we don't setState during render.
    queueMicrotask(() => {
      setStage((cur) =>
        cur.kind === 'waiting_receipt'
          ? { kind: 'confirming', txHash: cur.txHash, pendingId: cur.pendingId }
          : cur,
      );
      void sendConfirm(stage.pendingId, stage.txHash);
    });
  }

  async function sendConfirm(pendingId: string, txHash: Hex) {
    try {
      const res = await fetch('/api/streamers/create-confirm', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingId, txHash }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStage({
          kind: 'error',
          message:
            body.error === 'tx_verification_failed'
              ? 'On-chain verification failed. Contact support.'
              : `Server rejected: ${body.error ?? res.status}`,
          txHash,
          pendingId,
        });
        return;
      }
      clear();
      setStage({ kind: 'done', slug: body.slug });
      router.push(`/s/${encodeURIComponent(body.slug)}`);
    } catch (err) {
      setStage({
        kind: 'error',
        message: `Confirm failed: ${String(err)}. Retry via reconcile.`,
        txHash,
        pendingId,
      });
    }
  }

  async function onSubmit() {
    if (stage.kind !== 'idle' && stage.kind !== 'error') return;

    // ---- Admin / free path ------------------------------------
    if (!usesFeeFlow) {
      setStage({ kind: 'preparing' });
      try {
        const res = await fetch('/api/streamers/create-admin', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify(form),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) {
          setStage({
            kind: 'error',
            message:
              body.error === 'admin_required'
                ? 'Admin wallet required.'
                : body.error === 'unauthorized'
                  ? 'Connect a wallet (SIWE sign-in required).'
                  : `Create failed: ${body.error ?? res.status}`,
          });
          return;
        }
        clear();
        setStage({ kind: 'done', slug: body.slug });
        router.push(`/s/${encodeURIComponent(body.slug)}`);
      } catch (err) {
        setStage({ kind: 'error', message: `Create threw: ${String(err)}` });
      }
      return;
    }

    // ---- Fee path ---------------------------------------------
    if (!address) {
      openConnectModal?.();
      return;
    }
    if (!paymentsAddress || !tokenAddress) {
      setStage({
        kind: 'error',
        message:
          'NEXT_PUBLIC_PAYMENTS_ADDRESS / NEXT_PUBLIC_TOKEN_ADDRESS not configured.',
      });
      return;
    }

    try {
      setStage({ kind: 'preparing' });
      if (activeChainId !== expectedChainId) {
        await switchChainAsync({ chainId: expectedChainId });
      }

      const prepRes = await fetch('/api/streamers/create-prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(form),
      });
      const prep = await prepRes.json().catch(() => ({}));
      if (!prepRes.ok) {
        setStage({
          kind: 'error',
          message:
            prep.error === 'wallet_required'
              ? 'Connect a wallet first.'
              : prep.error === 'slug_taken'
                ? 'That name is taken — pick another.'
                : `Prepare failed: ${prep.error ?? prepRes.status}`,
        });
        return;
      }

      const feeAmount = BigInt(prep.deployFeeAmount);
      const payments = getAddress(prep.paymentsAddress as string);
      const token = getAddress(prep.tokenAddress as string);
      const pendingId = prep.pendingId as string;
      const pendingIdBytes32 = prep.pendingIdBytes32 as Hex;

      // Approve if allowance insufficient.
      if ((allowance as bigint | undefined) === undefined || (allowance as bigint) < feeAmount) {
        setStage({ kind: 'approving' });
        await writeContractAsync({
          address: token,
          abi: erc20Abi,
          functionName: 'approve',
          args: [payments, feeAmount],
        });
      }

      setStage({ kind: 'signing_pay' });
      const txHash = await writeContractAsync({
        address: payments,
        abi: DEPLOY_FEE_ABI,
        functionName: 'payDeployFee',
        args: [pendingIdBytes32],
      });
      setStage({ kind: 'waiting_receipt', txHash, pendingId });
    } catch (err) {
      setStage({
        kind: 'error',
        message: `Tx failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  async function onReconcile() {
    if (stage.kind !== 'error' || !stage.pendingId || !stage.txHash) return;
    try {
      setStage({
        kind: 'confirming',
        txHash: stage.txHash,
        pendingId: stage.pendingId,
      });
      const res = await fetch('/api/streamers/create-reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingId: stage.pendingId, txHash: stage.txHash }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setStage({
          kind: 'error',
          message: `Reconcile failed: ${body.error ?? res.status}`,
          txHash: stage.txHash,
          pendingId: stage.pendingId,
        });
        return;
      }
      clear();
      setStage({ kind: 'done', slug: body.slug });
      router.push(`/s/${encodeURIComponent(body.slug)}`);
    } catch (err) {
      setStage({
        kind: 'error',
        message: `Reconcile threw: ${String(err)}`,
      });
    }
  }

  const stageMessage = useMemo(() => {
    switch (stage.kind) {
      case 'preparing':
        return 'Preparing…';
      case 'approving':
        return 'Approving token spend…';
      case 'signing_pay':
        return 'Confirm the deploy fee tx in your wallet…';
      case 'waiting_receipt':
        return `Waiting for confirmation (${stage.txHash.slice(0, 10)}…)`;
      case 'confirming':
        return 'Finalising on server…';
      case 'done':
        return `Deployed as /s/${stage.slug}`;
      case 'error':
        return stage.message;
      default:
        return null;
    }
  }, [stage]);

  if (!loaded) {
    return (
      <p className="py-8 text-center text-sm text-muted-foreground">Loading…</p>
    );
  }

  return (
    <div className="mx-auto w-full max-w-3xl space-y-6 py-8">
      {/* Stepper */}
      <ol className="flex items-center gap-2 overflow-x-auto text-xs">
        {STEP_LABELS.map((label, idx) => {
          const active = idx === step;
          const reached = idx <= step;
          return (
            <li key={label} className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => (idx < step ? setStep(idx) : undefined)}
                className={cn(
                  'rounded-full px-3 py-1 font-medium',
                  active
                    ? 'bg-primary text-primary-foreground'
                    : reached
                      ? 'bg-card text-foreground ring-1 ring-border'
                      : 'text-muted-foreground',
                )}
              >
                {idx + 1}. {label}
              </button>
              {idx < STEP_LABELS.length - 1 ? (
                <span className="text-muted-foreground/50">›</span>
              ) : null}
            </li>
          );
        })}
      </ol>

      {/* Active step */}
      <section className="rounded-xl border border-border bg-card p-5">
        {step === 0 ? <PersonalityStep form={form} updateForm={updateForm} /> : null}
        {step === 1 ? <VoiceStep form={form} updateForm={updateForm} /> : null}
        {step === 2 ? <AvatarStep form={form} updateForm={updateForm} /> : null}
        {step === 3 ? (
          <ReviewStep form={form} tokenLive={tokenLive} isAdmin={isAdmin} />
        ) : null}
      </section>

      {/* Stage status */}
      {stageMessage ? (
        <div
          className={cn(
            'rounded-lg border px-3 py-2 text-sm',
            stage.kind === 'error'
              ? 'border-destructive/60 bg-destructive/10 text-destructive-foreground'
              : stage.kind === 'done'
                ? 'border-emerald-500/60 bg-emerald-500/10 text-emerald-200'
                : 'border-border bg-card text-muted-foreground',
          )}
        >
          {stageMessage}
        </div>
      ) : null}

      {/* Controls */}
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => setStep(Math.max(0, step - 1))}
            disabled={step === 0}
          >
            Back
          </Button>
          <Button
            type="button"
            variant="ghost"
            onClick={() => {
              if (confirm('Discard draft?')) clear();
            }}
          >
            Clear draft
          </Button>
        </div>
        <div className="flex gap-2">
          {stage.kind === 'error' && stage.txHash && stage.pendingId ? (
            <Button type="button" variant="outline" onClick={onReconcile}>
              Reconcile with last tx
            </Button>
          ) : null}
          {step < 3 ? (
            <Button
              type="button"
              onClick={() => setStep(Math.min(3, step + 1))}
              disabled={!canAdvance}
            >
              Next
            </Button>
          ) : (
            <Button
              type="button"
              onClick={onSubmit}
              disabled={
                stage.kind === 'preparing' ||
                stage.kind === 'approving' ||
                stage.kind === 'signing_pay' ||
                stage.kind === 'waiting_receipt' ||
                stage.kind === 'confirming'
              }
            >
              {usesFeeFlow
                ? isConnected
                  ? 'Pay fee & deploy'
                  : 'Connect wallet to deploy'
                : 'Deploy (free)'}
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}
