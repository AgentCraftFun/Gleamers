'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Hero } from './Hero';
import { LiveCard } from './LiveCard';
import { CooldownCard } from './CooldownCard';
import { ReadyCard } from './ReadyCard';
import type { HomeStreamer } from './types';
import { fetchActive, fetchSpeakingStatus, type ActiveStreamer } from '@/lib/orchestrator';
import { getSupabaseBrowser } from '@/lib/supabase';
import type { StreamerStatus } from '@gleamers/shared';

interface Props {
  tokenLive: boolean;
  initial: {
    live: HomeStreamer[];
    cooldown: HomeStreamer[];
    ready: HomeStreamer[];
  };
}

const POLL_INTERVAL_MS = 3000;
const COOLDOWN_LIMIT = 12;
const READY_LIMIT = 8;

function sortCooldown(a: HomeStreamer, b: HomeStreamer): number {
  const at = a.ready_at ? new Date(a.ready_at).getTime() : Infinity;
  const bt = b.ready_at ? new Date(b.ready_at).getTime() : Infinity;
  return at - bt;
}

function sortReady(a: HomeStreamer, b: HomeStreamer): number {
  const at = a.last_active_at ? new Date(a.last_active_at).getTime() : 0;
  const bt = b.last_active_at ? new Date(b.last_active_at).getTime() : 0;
  return bt - at;
}

export function HomeClient({ tokenLive, initial }: Props) {
  const [live, setLive] = useState<HomeStreamer[]>(initial.live);
  const [cooldown, setCooldown] = useState<HomeStreamer[]>(initial.cooldown);
  const [ready, setReady] = useState<HomeStreamer[]>(initial.ready);

  const [activeInfo, setActiveInfo] = useState<
    Record<string, ActiveStreamer>
  >({});
  const [speaking, setSpeaking] = useState<Record<string, boolean>>({});

  // --- Orchestrator poll ---
  const poll = useCallback(async () => {
    const [active, speak] = await Promise.all([
      fetchActive(),
      fetchSpeakingStatus(),
    ]);
    const byslug: Record<string, ActiveStreamer> = {};
    for (const a of active) byslug[a.slug] = a;
    setActiveInfo(byslug);
    setSpeaking(speak);
  }, []);

  useEffect(() => {
    void poll();
    const id = window.setInterval(() => {
      void poll();
    }, POLL_INTERVAL_MS);
    return () => window.clearInterval(id);
  }, [poll]);

  // --- Supabase realtime (streamers table) ---
  useEffect(() => {
    let sb;
    try {
      sb = getSupabaseBrowser();
    } catch {
      return;
    }
    const channel = sb
      .channel('streamers-home')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'streamers' },
        (payload) => {
          const row = (payload.new ?? payload.old) as HomeStreamer | undefined;
          if (!row) return;
          applyStreamerUpdate(row, payload.eventType as 'INSERT' | 'UPDATE' | 'DELETE');
        },
      )
      .subscribe();

    function applyStreamerUpdate(
      row: HomeStreamer,
      evt: 'INSERT' | 'UPDATE' | 'DELETE',
    ) {
      const removeFromAll = (slug: string) => {
        setLive((prev) => prev.filter((s) => s.slug !== slug));
        setCooldown((prev) => prev.filter((s) => s.slug !== slug));
        setReady((prev) => prev.filter((s) => s.slug !== slug));
      };

      if (evt === 'DELETE') {
        removeFromAll(row.slug);
        return;
      }

      removeFromAll(row.slug);
      const target: StreamerStatus = row.status;
      if (target === 'LIVE') {
        setLive((prev) => [...prev, row]);
      } else if (target === 'COOLING_DOWN') {
        setCooldown((prev) => [...prev, row].sort(sortCooldown).slice(0, COOLDOWN_LIMIT));
      } else if (target === 'READY') {
        setReady((prev) => [...prev, row].sort(sortReady).slice(0, READY_LIMIT));
      }
    }

    return () => {
      void sb.removeChannel(channel);
    };
  }, []);

  const liveSorted = useMemo(
    () =>
      [...live].sort((a, b) => {
        const aInfo = activeInfo[a.slug];
        const bInfo = activeInfo[b.slug];
        return (bInfo?.viewers ?? 0) - (aInfo?.viewers ?? 0);
      }),
    [live, activeInfo],
  );

  return (
    <>
      <Hero tokenLive={tokenLive} liveCount={liveSorted.length} />

      <div className="mx-auto max-w-[1600px] px-4 py-10 lg:px-6">
        {/* LIVE NOW */}
        <section id="live" className="mb-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Live now
            </h2>
            <span className="text-xs text-muted-foreground">
              {liveSorted.length} streaming
            </span>
          </div>
          {liveSorted.length === 0 ? (
            <EmptyState text="No one's live right now. Revival sessions kick in soon." />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {liveSorted.map((s) => {
                const info = activeInfo[s.slug];
                const sessionType = info?.sessionType ?? 'normal';
                return (
                  <LiveCard
                    key={s.id}
                    streamer={s}
                    viewers={info?.viewers ?? 0}
                    secondsRemaining={info?.secondsRemaining ?? null}
                    speaking={Boolean(speaking[s.slug])}
                    sessionType={sessionType}
                  />
                );
              })}
            </div>
          )}
        </section>

        {/* COMING BACK SOON */}
        <section className="mb-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Coming back soon
            </h2>
            <span className="text-xs text-muted-foreground">
              {cooldown.length} cooling down
            </span>
          </div>
          {cooldown.length === 0 ? (
            <EmptyState text="No one on cooldown. That's either good news or quiet news." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
              {cooldown.map((s) => (
                <CooldownCard key={s.id} streamer={s} />
              ))}
            </div>
          )}
        </section>

        {/* READY TO STREAM */}
        <section className="mb-12">
          <div className="mb-4 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
              Ready to stream
            </h2>
            <span className="text-xs text-muted-foreground">
              {ready.length} idle
            </span>
          </div>
          {ready.length === 0 ? (
            <EmptyState text="No deployed streamers waiting in the wings." />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-4">
              {ready.map((s) => (
                <ReadyCard key={s.id} streamer={s} />
              ))}
            </div>
          )}
        </section>
      </div>
    </>
  );
}

function EmptyState({ text }: { text: string }) {
  return (
    <div className="rounded-xl border border-dashed border-border bg-card/50 p-6 text-center text-sm text-muted-foreground">
      {text}
    </div>
  );
}
