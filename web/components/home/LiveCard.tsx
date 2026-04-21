'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { formatMmSs, truncateWallet } from '@/lib/format';
import { StreamerThumb } from './StreamerThumb';
import { Waveform } from './Waveform';
import type { HomeStreamer } from './types';

interface Props {
  streamer: HomeStreamer;
  viewers: number;
  secondsRemaining: number | null;
  speaking: boolean;
  sessionType: 'debut' | 'normal' | 'revival';
}

export function LiveCard({
  streamer,
  viewers,
  secondsRemaining,
  speaking,
  sessionType,
}: Props) {
  return (
    <article className="group relative flex flex-col overflow-hidden rounded-xl border border-border bg-card transition hover:border-primary/50">
      <div className="relative aspect-[16/11] overflow-hidden">
        <StreamerThumb
          name={streamer.name}
          thumbnailUrl={streamer.thumbnail_url}
        />

        {/* LIVE dot */}
        <div className="absolute left-3 top-3 flex items-center gap-2 rounded-full bg-black/60 px-2 py-1 backdrop-blur">
          <span className="relative flex size-2 items-center justify-center">
            <span
              className="absolute inline-flex size-full rounded-full bg-red-500 animate-live-pulse"
              aria-hidden
            />
            <span className="relative inline-flex size-2 rounded-full bg-red-500" />
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-widest text-white">
            Live
          </span>
        </div>

        {/* Revival badge */}
        {sessionType === 'revival' ? (
          <div className="absolute right-3 top-3 rounded-full bg-amber-500/20 px-2 py-1 text-[10px] font-semibold uppercase tracking-widest text-amber-200 ring-1 ring-amber-500/40 backdrop-blur">
            Revival
          </div>
        ) : null}

        {/* Time remaining + waveform */}
        <div className="absolute inset-x-0 bottom-0 flex items-end justify-between gap-3 bg-gradient-to-t from-black/70 to-transparent p-3">
          <div className="flex items-center gap-2">
            <Waveform active={speaking} className="text-emerald-300" />
            <span
              className={cn(
                'text-[11px] font-medium uppercase tracking-widest',
                speaking ? 'text-emerald-300' : 'text-white/70',
              )}
            >
              {speaking ? 'Speaking' : 'Quiet'}
            </span>
          </div>
          <span className="rounded-md bg-black/50 px-2 py-1 font-mono text-xs tabular-nums text-white">
            {formatMmSs(secondsRemaining)}
          </span>
        </div>
      </div>

      <div className="flex flex-1 flex-col gap-2 p-4">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-lg font-semibold">{streamer.name}</h3>
          <span className="text-xs text-muted-foreground">
            {viewers.toLocaleString()} watching
          </span>
        </div>
        <p className="text-xs text-muted-foreground">
          by{' '}
          <code className="font-mono">
            {truncateWallet(streamer.owner_wallet)}
          </code>
        </p>
        <Button asChild size="sm" className="mt-auto">
          <Link href={`/s/${encodeURIComponent(streamer.slug)}`}>Watch</Link>
        </Button>
      </div>
    </article>
  );
}
