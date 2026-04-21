'use client';

import { useEffect, useMemo, useState } from 'react';
import { erc20Abi, getAddress, type Address, type Hex } from 'viem';
import {
  useAccount,
  useSwitchChain,
  useWaitForTransactionReceipt,
  useWriteContract,
} from 'wagmi';
import {
  SUPER_CHAT_MAX_CHARS,
  SUPER_CHAT_TIER_COPY,
  SUPER_CHAT_TIERS,
  SuperChatTier,
  type SuperChatTier as SuperChatTierT,
} from '@gleamers/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getChainId } from '@/lib/chain';
import { paymentsAbi } from '@/lib/super-chat/abi';
import { useTierAmounts } from '@/lib/super-chat/useTierAmounts';

interface Props {
  slug: string;
  open: boolean;
  onClose: () => void;
}

type Stage =
  | { kind: 'idle' }
  | { kind: 'preparing' }
  | { kind: 'approving'; txHash?: Hex }
  | { kind: 'signing' }
  | { kind: 'submitting'; txHash: Hex }
  | { kind: 'done' }
  | { kind: 'error'; message: string };

const TIER_STYLES: Record<SuperChatTierT, string> = {
  1: 'border-amber-500/60 bg-amber-500/10',
  2: 'border-purple-500/60 bg-purple-500/10',
  3: 'border-fuchsia-500/60 bg-gradient-to-br from-fuchsia-500/15 via-purple-500/15 to-amber-500/15',
};

function formatTokenAmount(raw: bigint | null, decimals = 18): string {
  if (raw === null) return '—';
  // Cheap formatting: trim to 4 significant decimals.
  const whole = raw / 10n ** BigInt(decimals);
  const frac = raw % 10n ** BigInt(decimals);
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac
    .toString()
    .padStart(decimals, '0')
    .slice(0, 4)
    .replace(/0+$/, '');
  return `${whole.toLocaleString()}${fracStr ? `.${fracStr}` : ''}`;
}

export function SuperChatModal({ slug, open, onClose }: Props) {
  const { address, chainId: activeChainId } = useAccount();
  const expectedChainId = getChainId();
  const { switchChainAsync } = useSwitchChain();
  const { amounts, allowance, paymentsAddress, tokenAddress, loading } =
    useTierAmounts();
  const { writeContractAsync } = useWriteContract();

  const [tier, setTier] = useState<SuperChatTierT>(SuperChatTier.TIER_1);
  const [message, setMessage] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'idle' });
  const [txHash, setTxHash] = useState<Hex | null>(null);
  const [pendingId, setPendingId] = useState<string | null>(null);

  useEffect(() => {
    if (!open) {
      setTier(SuperChatTier.TIER_1);
      setMessage('');
      setStage({ kind: 'idle' });
      setTxHash(null);
      setPendingId(null);
    }
  }, [open]);

  const receipt = useWaitForTransactionReceipt({
    hash: stage.kind === 'submitting' ? stage.txHash : undefined,
    query: { enabled: stage.kind === 'submitting' },
  });

  useEffect(() => {
    if (stage.kind !== 'submitting') return;
    if (!receipt.data) return;
    // Tx confirmed — finalise server-side.
    (async () => {
      try {
        const res = await fetch('/api/super-chat/submit', {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ pendingId, txHash: stage.txHash }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          setStage({
            kind: 'error',
            message: body.error
              ? `Server rejected: ${body.error}. You can retry via the reconcile flow.`
              : `Server error ${res.status}`,
          });
          return;
        }
        setStage({ kind: 'done' });
      } catch (err) {
        setStage({
          kind: 'error',
          message: `Submit failed: ${String(err)}. Retry reconcile below.`,
        });
      }
    })();
  }, [receipt.data, stage, pendingId]);

  const selectedAmount = amounts[tier];
  const tierInfo = SUPER_CHAT_TIER_COPY[tier];
  const pinInfo = SUPER_CHAT_TIERS[tier];

  const canSend = useMemo(() => {
    if (!address || !paymentsAddress || !tokenAddress) return false;
    if (!message.trim()) return false;
    if (message.length > SUPER_CHAT_MAX_CHARS) return false;
    if (selectedAmount === null || selectedAmount === 0n) return false;
    if (stage.kind !== 'idle' && stage.kind !== 'error') return false;
    return true;
  }, [address, paymentsAddress, tokenAddress, message, selectedAmount, stage]);

  async function ensureNetwork(): Promise<void> {
    if (activeChainId !== expectedChainId) {
      await switchChainAsync({ chainId: expectedChainId });
    }
  }

  async function onSend() {
    if (!canSend) return;
    if (!paymentsAddress || !tokenAddress || !address) return;
    if (selectedAmount === null) return;

    setStage({ kind: 'preparing' });
    try {
      await ensureNetwork();

      const prepRes = await fetch('/api/super-chat/prepare', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ slug, tier, message: message.trim() }),
      });
      if (!prepRes.ok) {
        const body = await prepRes.json().catch(() => ({}));
        setStage({
          kind: 'error',
          message:
            body.error === 'moderation_blocked'
              ? 'Moderation blocked that message — edit and try again.'
              : `Prepare failed: ${body.error ?? prepRes.status}`,
        });
        return;
      }
      type PrepareResponse = {
        pendingId: string;
        tierAmount: string;
        streamerIdBytes32: Hex;
        streamerOwner: Address;
        messageHash: Hex;
      };
      const prepared = (await prepRes.json()) as PrepareResponse;
      setPendingId(prepared.pendingId);
      const tierAmount = BigInt(prepared.tierAmount);

      // Approve if allowance insufficient.
      if ((allowance ?? 0n) < tierAmount) {
        setStage({ kind: 'approving' });
        const approveHash = await writeContractAsync({
          address: getAddress(tokenAddress),
          abi: erc20Abi,
          functionName: 'approve',
          args: [getAddress(paymentsAddress), tierAmount],
        });
        setStage({ kind: 'approving', txHash: approveHash });
      }

      // Super chat tx.
      setStage({ kind: 'signing' });
      const superHash = await writeContractAsync({
        address: getAddress(paymentsAddress),
        abi: paymentsAbi,
        functionName: 'superChat',
        args: [
          prepared.streamerIdBytes32,
          tier,
          prepared.messageHash,
          getAddress(prepared.streamerOwner),
        ],
      });
      setTxHash(superHash);
      setStage({ kind: 'submitting', txHash: superHash });
    } catch (err) {
      setStage({
        kind: 'error',
        message: `Tx failed: ${err instanceof Error ? err.message : String(err)}`,
      });
    }
  }

  async function onReconcile() {
    if (!pendingId || !txHash) return;
    setStage({ kind: 'submitting', txHash });
    try {
      const res = await fetch('/api/super-chat/reconcile', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ pendingId, txHash }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setStage({
          kind: 'error',
          message: `Reconcile failed: ${body.error ?? res.status}`,
        });
        return;
      }
      setStage({ kind: 'done' });
    } catch (err) {
      setStage({
        kind: 'error',
        message: `Reconcile threw: ${String(err)}`,
      });
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-xl rounded-xl border border-border bg-card p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-lg font-semibold">Send a super chat</h2>
            <p className="text-xs text-muted-foreground">
              90% goes to the streamer owner, 10% to the treasury.
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-sm text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            ×
          </button>
        </div>

        {/* Tier picker */}
        <div className="mt-4 grid grid-cols-3 gap-2">
          {([1, 2, 3] as SuperChatTierT[]).map((t) => {
            const info = SUPER_CHAT_TIER_COPY[t];
            const amt = amounts[t];
            const selected = tier === t;
            return (
              <button
                key={t}
                type="button"
                onClick={() => setTier(t)}
                className={cn(
                  'flex flex-col gap-1 rounded-lg border p-3 text-left transition',
                  TIER_STYLES[t],
                  selected
                    ? 'ring-2 ring-primary'
                    : 'opacity-80 hover:opacity-100',
                )}
              >
                <span className="text-[10px] font-semibold uppercase tracking-widest">
                  {info.name}
                </span>
                <span className="font-mono text-sm">
                  {loading ? '…' : formatTokenAmount(amt)}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {info.pinBlurb}
                </span>
                <span className="text-[11px] text-muted-foreground">
                  {info.priorityBlurb}
                </span>
              </button>
            );
          })}
        </div>

        {/* Message */}
        <div className="mt-4">
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value.slice(0, SUPER_CHAT_MAX_CHARS))}
            rows={3}
            placeholder="What do you want them to address?"
            disabled={stage.kind !== 'idle' && stage.kind !== 'error'}
            className="w-full resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
          />
          <div className="mt-1 flex items-center justify-between text-[11px] text-muted-foreground">
            <span>
              Tier amount:{' '}
              <span className="font-mono text-foreground">
                {selectedAmount ? formatTokenAmount(selectedAmount) : '…'}
              </span>
            </span>
            <span>
              {message.length} / {SUPER_CHAT_MAX_CHARS}
            </span>
          </div>
        </div>

        {/* Stage / errors */}
        <div className="mt-3 min-h-[1.75rem] text-sm">
          {stage.kind === 'preparing' ? 'Preparing…' : null}
          {stage.kind === 'approving' ? 'Approving token spend…' : null}
          {stage.kind === 'signing' ? 'Confirm the super chat tx…' : null}
          {stage.kind === 'submitting'
            ? `Waiting for ${stage.txHash.slice(0, 10)}… ${pinInfo.priority}`
            : null}
          {stage.kind === 'done' ? (
            <span className="text-emerald-300">
              Super chat delivered.
            </span>
          ) : null}
          {stage.kind === 'error' ? (
            <span className="text-destructive-foreground">{stage.message}</span>
          ) : null}
        </div>

        {/* Footer */}
        <div className="mt-4 flex flex-wrap items-center justify-end gap-2">
          {stage.kind === 'error' && txHash ? (
            <Button variant="outline" size="sm" onClick={onReconcile}>
              Reconcile with last tx
            </Button>
          ) : null}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
          <Button
            onClick={onSend}
            disabled={!canSend || stage.kind === 'submitting'}
          >
            {stage.kind === 'idle' || stage.kind === 'error'
              ? 'Send super chat'
              : 'Working…'}
          </Button>
        </div>
      </div>
    </div>
  );
}
