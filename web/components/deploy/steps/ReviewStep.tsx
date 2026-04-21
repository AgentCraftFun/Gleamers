'use client';

import { useReadContract } from 'wagmi';
import { getAddress, type Address } from 'viem';

import { DEPLOY_VOICES } from '@gleamers/shared';
import type { DeployFormInput } from '@/lib/deploy/validate';
import { DEPLOY_FEE_ABI } from '@/lib/deploy/chain';
import { cn } from '@/lib/utils';

interface Props {
  form: DeployFormInput;
  tokenLive: boolean;
  isAdmin: boolean;
}

function formatTokenAmount(raw: bigint | null | undefined, decimals = 18) {
  if (raw == null) return '—';
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

function FeeBadge({
  tokenLive,
  isAdmin,
}: {
  tokenLive: boolean;
  isAdmin: boolean;
}) {
  const address = process.env.NEXT_PUBLIC_PAYMENTS_ADDRESS;
  const enabled = tokenLive && !!address;
  const payments: Address | undefined = enabled
    ? getAddress(address!)
    : undefined;

  const { data } = useReadContract({
    address: payments,
    abi: DEPLOY_FEE_ABI,
    functionName: 'deployFeeAmount',
    query: { enabled: Boolean(payments) },
  });

  if (!tokenLive) {
    return (
      <div className="rounded-lg border border-amber-500/40 bg-amber-500/5 p-3 text-sm">
        <p className="font-semibold text-amber-200">Pre-launch deploy</p>
        <p className="text-xs text-muted-foreground">
          Admin allowlist only. No fee required.
        </p>
      </div>
    );
  }
  if (isAdmin) {
    return (
      <div className="rounded-lg border border-emerald-500/40 bg-emerald-500/5 p-3 text-sm">
        <p className="font-semibold text-emerald-200">Admin deploy — free</p>
        <p className="text-xs text-muted-foreground">
          Fee bypassed. deploy_fee_paid will be recorded as 0.
        </p>
      </div>
    );
  }
  return (
    <div className="rounded-lg border border-primary/40 bg-primary/5 p-3 text-sm">
      <p className="font-semibold">
        Deploy fee:{' '}
        <span className="font-mono">
          {formatTokenAmount(data as bigint | undefined)}
        </span>{' '}
        tokens
      </p>
      <p className="text-xs text-muted-foreground">
        20% burned, 80% treasury. Gas paid by you.
      </p>
    </div>
  );
}

export function ReviewStep({ form, tokenLive, isAdmin }: Props) {
  const voice = DEPLOY_VOICES.find((v) => v.id === form.voice_id);
  return (
    <div className="space-y-5">
      <div>
        <h2 className="text-lg font-semibold">4. Review &amp; deploy</h2>
        <p className="text-sm text-muted-foreground">
          Double-check everything before sending. You can come back and edit
          any step — your draft is saved in this browser.
        </p>
      </div>

      <FeeBadge tokenLive={tokenLive} isAdmin={isAdmin} />

      <div className="rounded-lg border border-destructive/40 bg-destructive/5 p-3 text-sm">
        <p className="font-semibold text-destructive-foreground">
          Heads up — debut starts immediately
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          Your 60-minute debut begins the instant the deploy confirms. After
          the session ends, your streamer enters a 3-hour cooldown. Sessions
          can&apos;t be stopped early.
        </p>
      </div>

      <dl className="grid gap-3 rounded-lg border border-border bg-card p-4 text-sm sm:grid-cols-2">
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Name
          </dt>
          <dd className="font-medium">{form.name || '—'}</dd>
        </div>
        <div>
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Voice
          </dt>
          <dd className="font-medium">
            {voice ? `${voice.label} (${voice.accent})` : form.voice_id || '—'}
          </dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Vibe
          </dt>
          <dd>{form.vibe || '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Speech patterns
          </dt>
          <dd>{form.speech_patterns || '—'}</dd>
        </div>
        <div className="sm:col-span-2">
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Backstory
          </dt>
          <dd className="whitespace-pre-wrap text-sm">
            {form.backstory || '—'}
          </dd>
        </div>

        <ReviewList label="Core opinions" items={form.core_opinions} />
        <ReviewList label="Likes" items={form.likes} />
        <ReviewList label="Hates" items={form.hates} />
        <ReviewList label="Monologue topics" items={form.monologue_topics} />
        <ReviewList label="Quirks" items={form.quirks} />
        <ReviewList label="Taboo topics" items={form.taboo_topics} />

        <div className="sm:col-span-2">
          <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
            Avatar
          </dt>
          <dd className="break-all font-mono text-xs">
            {form.avatar_vrm_url || '—'}
          </dd>
        </div>
      </dl>
    </div>
  );
}

function ReviewList({ label, items }: { label: string; items: string[] }) {
  return (
    <div>
      <dt className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {label}
      </dt>
      <dd className={cn('text-sm', items.length === 0 && 'text-muted-foreground')}>
        {items.length === 0 ? '—' : items.join(' · ')}
      </dd>
    </div>
  );
}
