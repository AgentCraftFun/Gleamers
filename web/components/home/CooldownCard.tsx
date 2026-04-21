'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { formatHmmSs, truncateWallet } from '@/lib/format';
import { StreamerThumb } from './StreamerThumb';
import type { HomeStreamer } from './types';

interface Props {
  streamer: HomeStreamer;
}

function useSecondsUntil(iso: string | null): number | null {
  const [secs, setSecs] = useState<number | null>(() =>
    iso ? Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)) : null,
  );
  useEffect(() => {
    if (!iso) {
      setSecs(null);
      return;
    }
    const tick = () =>
      setSecs(Math.max(0, Math.floor((new Date(iso).getTime() - Date.now()) / 1000)));
    tick();
    const id = window.setInterval(tick, 1000);
    return () => window.clearInterval(id);
  }, [iso]);
  return secs;
}

export function CooldownCard({ streamer }: Props) {
  const remaining = useSecondsUntil(streamer.ready_at);
  const [notified, setNotified] = useState(false);

  return (
    <article className="flex gap-3 rounded-xl border border-border bg-card p-3 transition hover:border-primary/40">
      <div className="size-16 flex-none overflow-hidden rounded-lg">
        <StreamerThumb
          name={streamer.name}
          thumbnailUrl={streamer.thumbnail_url}
        />
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-1">
        <div className="flex items-center justify-between gap-2">
          <Link
            href={`/s/${encodeURIComponent(streamer.slug)}`}
            className="truncate text-sm font-semibold hover:underline"
          >
            {streamer.name}
          </Link>
          <span className="rounded-md bg-blue-500/20 px-2 py-0.5 font-mono text-[11px] tabular-nums text-blue-200">
            {formatHmmSs(remaining)}
          </span>
        </div>
        <p className="truncate text-xs text-muted-foreground">
          by{' '}
          <code className="font-mono">
            {truncateWallet(streamer.owner_wallet)}
          </code>
        </p>
        <Button
          size="sm"
          variant="outline"
          className="mt-1 self-start text-xs"
          onClick={() => setNotified((n) => !n)}
        >
          {notified ? 'Will notify ✓' : 'Notify me'}
        </Button>
      </div>
    </article>
  );
}
