'use client';

import { useMemo } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { VRMAvatar } from '@/components/vrm/VRMAvatar';
import { cn } from '@/lib/utils';
import { useWorkerSession } from '@/lib/workerSession';
import type { StreamerStatus } from '@gleamers/shared';

interface Props {
  streamer: {
    id: string;
    name: string;
    slug: string;
    owner_wallet: string;
    status: StreamerStatus;
    avatar_vrm_url: string;
  };
  workerWsUrl: string | null;
}

const STATUS_STYLE: Record<StreamerStatus, string> = {
  LIVE: 'bg-red-500/20 text-red-300 border-red-500/40',
  COOLING_DOWN: 'bg-blue-500/20 text-blue-200 border-blue-500/40',
  READY: 'bg-emerald-500/20 text-emerald-200 border-emerald-500/40',
  OFFLINE: 'bg-muted text-muted-foreground border-border',
};

const STATUS_LABEL: Record<StreamerStatus, string> = {
  LIVE: 'Live',
  COOLING_DOWN: 'Cooling down',
  READY: 'Ready',
  OFFLINE: 'Offline',
};

function truncateWallet(wallet: string): string {
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

function formatRemaining(sec: number | null): string {
  if (sec === null) return '—';
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = (sec % 60).toString().padStart(2, '0');
  return `${m}:${s}`;
}

export default function StreamerClient({ streamer, workerWsUrl }: Props) {
  const isLive = streamer.status === 'LIVE';
  const vrmUrl = streamer.avatar_vrm_url || '/demo.vrm';

  const {
    status: wsStatus,
    hello,
    secondsRemaining,
    subtitles,
    expression,
    sessionEnded,
    audioElement,
    unlockAudio,
    audioUnlocked,
  } = useWorkerSession({
    wsUrl: isLive ? workerWsUrl : null,
    enabled: isLive,
  });

  const headerTitle = hello?.streamerName ?? streamer.name;

  const connectionPill = useMemo(() => {
    if (!isLive) return null;
    const map: Record<typeof wsStatus, string> = {
      idle: 'idle',
      connecting: 'connecting…',
      open: 'live',
      closed: 'closed',
      error: 'error',
    };
    return (
      <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
        {map[wsStatus]}
      </span>
    );
  }, [isLive, wsStatus]);

  return (
    <main className="min-h-screen bg-background">
      <div className="mx-auto flex h-screen max-w-[1600px] flex-col gap-4 p-4 lg:p-6">
        <header className="flex flex-wrap items-center justify-between gap-4">
          <div>
            <Link
              href="/"
              className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              ← Gleamers
            </Link>
            <div className="mt-1 flex items-center gap-2">
              <h1 className="text-2xl font-semibold sm:text-3xl">
                {headerTitle}
              </h1>
              {connectionPill}
            </div>
            <p className="text-sm text-muted-foreground">
              Deployed by{' '}
              <code className="font-mono text-xs">
                {truncateWallet(streamer.owner_wallet)}
              </code>
            </p>
          </div>

          <div className="flex items-center gap-3">
            {isLive ? (
              <span className="rounded-md border border-border bg-card px-3 py-1 font-mono text-sm tabular-nums">
                {formatRemaining(secondsRemaining)}
              </span>
            ) : null}
            <span
              className={cn(
                'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
                STATUS_STYLE[streamer.status],
              )}
            >
              <span className="size-2 rounded-full bg-current" />
              {STATUS_LABEL[streamer.status]}
            </span>
          </div>
        </header>

        <div className="grid flex-1 gap-4 lg:grid-cols-3">
          <section className="relative min-h-[420px] overflow-hidden rounded-xl border border-border bg-card lg:col-span-2">
            <VRMAvatar
              vrmUrl={vrmUrl}
              audioElement={audioElement}
              expression={expression}
              isSleeping={!isLive}
            />

            {/* Subtitles */}
            {subtitles.length > 0 ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-4 mx-auto max-w-2xl px-4">
                <div className="rounded-xl bg-black/60 px-4 py-3 text-center text-sm text-white backdrop-blur">
                  {subtitles[subtitles.length - 1]?.content}
                </div>
              </div>
            ) : null}

            {/* Unlock audio overlay (first user gesture) */}
            {isLive && !audioUnlocked ? (
              <div className="absolute inset-0 flex items-center justify-center bg-black/40">
                <Button onClick={unlockAudio}>Tap to start audio</Button>
              </div>
            ) : null}

            {/* Session ended banner */}
            {sessionEnded ? (
              <div className="absolute inset-x-0 bottom-0 bg-black/70 px-4 py-3 text-center text-sm text-white">
                Session ended ({sessionEnded.reason}).
              </div>
            ) : null}
          </section>

          <aside className="flex min-h-[420px] flex-col rounded-xl border border-border bg-card p-4">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Chat
            </h2>
            <div className="mt-3 flex-1 rounded-lg border border-dashed border-border p-4 text-sm text-muted-foreground">
              Chat lands in a later prompt.
            </div>
          </aside>
        </div>
      </div>
    </main>
  );
}
