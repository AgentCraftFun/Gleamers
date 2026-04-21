'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { truncateWallet } from '@/lib/format';
import { StreamerRow } from '@/components/dashboard/StreamerRow';
import type { DashboardStreamer } from './types';

interface Props {
  walletAddress: string;
  streamers: DashboardStreamer[];
}

function totalLifetimeEarnings(rows: DashboardStreamer[]): bigint {
  let total = 0n;
  for (const r of rows) {
    try {
      total += BigInt(r.total_super_chat_earnings ?? '0');
    } catch {
      /* noop */
    }
  }
  return total;
}

function formatTokens(amount: bigint, decimals = 18): string {
  if (amount === 0n) return '0';
  const whole = amount / 10n ** BigInt(decimals);
  const frac = amount % 10n ** BigInt(decimals);
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac
    .toString()
    .padStart(decimals, '0')
    .slice(0, 4)
    .replace(/0+$/, '');
  return `${whole.toLocaleString()}${fracStr ? `.${fracStr}` : ''}`;
}

export function DashboardClient({ walletAddress, streamers }: Props) {
  const total = totalLifetimeEarnings(streamers);

  return (
    <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 lg:px-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <Link
            href="/"
            className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
          >
            ← Gleamers
          </Link>
          <h1 className="mt-1 text-3xl font-semibold tracking-tight">
            Dashboard
          </h1>
          <p className="text-sm text-muted-foreground">
            {streamers.length}{' '}
            {streamers.length === 1 ? 'streamer' : 'streamers'} owned by{' '}
            <code className="font-mono text-xs">
              {truncateWallet(walletAddress)}
            </code>
          </p>
        </div>
        <Button asChild>
          <Link href="/deploy">Deploy another</Link>
        </Button>
      </header>

      <section className="rounded-xl border border-border bg-card p-5">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Lifetime super chat earnings
            </h2>
            <p className="mt-1 font-mono text-3xl">{formatTokens(total)}</p>
            <p className="mt-1 text-xs text-muted-foreground">
              Across all streamers you own, paid directly to your wallet
              (90% after platform fee).
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
              Payout address
            </h3>
            <code className="mt-1 block break-all rounded-md bg-background px-2 py-1 font-mono text-xs">
              {walletAddress}
            </code>
          </div>
        </div>
        <p className="mt-3 text-xs text-muted-foreground">
          Super chats pay 90% directly to this wallet on settlement. We never
          hold your funds.
        </p>
      </section>

      <section className="space-y-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Your streamers
        </h2>
        {streamers.length === 0 ? (
          <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
            You haven&apos;t deployed anyone yet.{' '}
            <Link href="/deploy" className="text-primary underline-offset-4 hover:underline">
              Start from /deploy.
            </Link>
          </div>
        ) : (
          streamers.map((s) => <StreamerRow key={s.id} streamer={s} />)
        )}
      </section>

      <aside className="rounded-xl border border-border bg-card/70 p-4 text-xs text-muted-foreground">
        <p className="font-semibold text-foreground">How sessions work</p>
        <p className="mt-1">
          1 hour live, 3 hour cooldown, sessions can&apos;t be stopped early.
          Super chats pay directly to your wallet (90% after the platform
          fee); we never custody your funds. Personality edits take effect
          next session.
        </p>
      </aside>
    </main>
  );
}
