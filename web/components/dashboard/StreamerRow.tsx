'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import type { StreamerStatus } from '@gleamers/shared';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMmSs, formatHmmSs } from '@/lib/format';
import { StreamerThumb } from '@/components/home/StreamerThumb';
import { GoLiveModal } from './GoLiveModal';
import type { DashboardStreamer } from '@/app/dashboard/types';

interface Props {
  streamer: DashboardStreamer;
}

function useCountdownSeconds(targetIso: string | null): number | null {
  const [secs, setSecs] = useState<number | null>(() =>
    targetIso
      ? Math.max(
          0,
          Math.floor((new Date(targetIso).getTime() - Date.now()) / 1000),
        )
      : null,
  );
  useEffect(() => {
    if (!targetIso) {
      setSecs(null);
      return;
    }
    const tick = () =>
      setSecs(
        Math.max(
          0,
          Math.floor((new Date(targetIso).getTime() - Date.now()) / 1000),
        ),
      );
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [targetIso]);
  return secs;
}

function formatEarnings(raw: string | null | undefined, decimals = 18): string {
  if (!raw || raw === '0') return '0';
  try {
    const bn = BigInt(raw);
    const whole = bn / 10n ** BigInt(decimals);
    const frac = bn % 10n ** BigInt(decimals);
    if (frac === 0n) return whole.toLocaleString();
    const fracStr = frac
      .toString()
      .padStart(decimals, '0')
      .slice(0, 3)
      .replace(/0+$/, '');
    return `${whole.toLocaleString()}${fracStr ? `.${fracStr}` : ''}`;
  } catch {
    return raw;
  }
}

const STATUS_STYLES: Record<StreamerStatus, string> = {
  LIVE: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  COOLING_DOWN: 'bg-orange-500/20 text-orange-200 border-orange-500/40',
  READY: 'bg-blue-500/20 text-blue-200 border-blue-500/40',
  OFFLINE: 'bg-muted text-muted-foreground border-border',
};

export function StreamerRow({ streamer }: Props) {
  const router = useRouter();
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [reactivating, setReactivating] = useState(false);
  const [reactivateError, setReactivateError] = useState<string | null>(null);

  const liveSecs = useCountdownSeconds(
    streamer.status === 'LIVE'
      ? streamer.currentSession?.scheduledEndAt ?? null
      : null,
  );
  const cooldownSecs = useCountdownSeconds(
    streamer.status === 'COOLING_DOWN' ? streamer.ready_at : null,
  );

  async function reactivate() {
    setReactivating(true);
    setReactivateError(null);
    try {
      const res = await fetch(
        `/api/streamers/${encodeURIComponent(streamer.slug)}/reactivate`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setReactivateError(body.error ?? `Failed (${res.status})`);
        return;
      }
      router.refresh();
    } catch (err) {
      setReactivateError(String(err));
    } finally {
      setReactivating(false);
    }
  }

  const primaryAction = (() => {
    switch (streamer.status) {
      case 'LIVE':
        return (
          <Button asChild size="sm">
            <Link href={`/s/${encodeURIComponent(streamer.slug)}`}>View</Link>
          </Button>
        );
      case 'COOLING_DOWN':
        return (
          <Button asChild size="sm" variant="secondary">
            <Link href={`/s/${encodeURIComponent(streamer.slug)}`}>View</Link>
          </Button>
        );
      case 'READY':
        return (
          <Button size="sm" onClick={() => setGoLiveOpen(true)}>
            Go live
          </Button>
        );
      case 'OFFLINE':
        return (
          <Button
            size="sm"
            variant="outline"
            onClick={reactivate}
            disabled={reactivating}
          >
            {reactivating ? 'Starting…' : 'Reactivate'}
          </Button>
        );
    }
  })();

  const statusLine = (() => {
    switch (streamer.status) {
      case 'LIVE':
        return (
          <span className="font-mono tabular-nums text-emerald-300">
            ENDS IN {formatMmSs(liveSecs)}
          </span>
        );
      case 'COOLING_DOWN':
        return (
          <span className="font-mono tabular-nums text-orange-300">
            READY IN {formatHmmSs(cooldownSecs)}
          </span>
        );
      case 'READY':
        return <span className="text-blue-200">Ready to go live</span>;
      case 'OFFLINE':
        return <span className="text-muted-foreground">Offline</span>;
    }
  })();

  const last = streamer.lastSession;

  return (
    <article className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4 sm:flex-row sm:items-start">
      <div className="size-20 flex-none overflow-hidden rounded-lg">
        <StreamerThumb
          name={streamer.name}
          thumbnailUrl={streamer.thumbnail_url}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-lg font-semibold">{streamer.name}</h3>
            <p className="text-[11px] text-muted-foreground">
              /s/{streamer.slug} · deployed{' '}
              {new Date(streamer.created_at).toLocaleDateString()}
            </p>
          </div>
          <span
            className={cn(
              'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 text-[11px] font-medium',
              STATUS_STYLES[streamer.status],
            )}
          >
            <span
              className={cn(
                'size-1.5 rounded-full bg-current',
                streamer.status === 'LIVE' && 'animate-live-pulse',
              )}
            />
            {statusLine}
          </span>
        </div>

        <div className="grid gap-2 text-[11px] text-muted-foreground sm:grid-cols-4">
          <Stat label="Sessions" value={streamer.total_sessions.toString()} />
          <Stat
            label="Super chat earnings"
            value={formatEarnings(streamer.total_super_chat_earnings)}
          />
          <Stat
            label="Last peak"
            value={last ? last.peakViewers.toString() : '—'}
          />
          <Stat
            label="Last messages"
            value={last ? last.totalMessages.toString() : '—'}
          />
        </div>

        <div className="flex flex-wrap items-center gap-2">
          {primaryAction}
          <Button asChild size="sm" variant="ghost">
            <Link
              href={`/dashboard/edit/${encodeURIComponent(streamer.slug)}`}
            >
              Edit personality
            </Link>
          </Button>
          <Button asChild size="sm" variant="ghost">
            <Link
              href={`/s/${encodeURIComponent(streamer.slug)}#history`}
              className="text-muted-foreground"
            >
              Session history
            </Link>
          </Button>
        </div>

        {reactivateError ? (
          <p className="text-xs text-destructive-foreground">
            Reactivate failed: {reactivateError}
          </p>
        ) : null}
      </div>

      <GoLiveModal
        slug={streamer.slug}
        open={goLiveOpen}
        onClose={() => setGoLiveOpen(false)}
      />
    </article>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-md border border-border/60 bg-background px-2 py-1.5">
      <div className="uppercase tracking-widest">{label}</div>
      <div className="truncate font-mono text-sm text-foreground">{value}</div>
    </div>
  );
}
