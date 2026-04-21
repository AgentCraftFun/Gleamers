'use client';

import Link from 'next/link';
import { truncateWallet } from '@/lib/format';
import { StreamerThumb } from './StreamerThumb';
import type { HomeStreamer } from './types';

interface Props {
  streamer: HomeStreamer;
}

export function ReadyCard({ streamer }: Props) {
  return (
    <Link
      href={`/s/${encodeURIComponent(streamer.slug)}`}
      className="group flex flex-col gap-2 rounded-xl border border-border bg-card p-3 transition hover:border-emerald-500/40"
    >
      <div className="aspect-square overflow-hidden rounded-lg">
        <StreamerThumb
          name={streamer.name}
          thumbnailUrl={streamer.thumbnail_url}
        />
      </div>
      <div className="flex min-w-0 flex-col">
        <div className="flex items-center justify-between gap-2">
          <h3 className="truncate text-sm font-semibold">{streamer.name}</h3>
          <span className="rounded-full bg-emerald-500/20 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-emerald-200">
            Ready
          </span>
        </div>
        <p className="truncate text-[11px] text-muted-foreground">
          by{' '}
          <code className="font-mono">
            {truncateWallet(streamer.owner_wallet)}
          </code>
        </p>
        <p className="text-[11px] text-muted-foreground">
          Owner can start anytime.
        </p>
      </div>
    </Link>
  );
}
