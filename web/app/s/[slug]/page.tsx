import { notFound } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseServer } from '@/lib/supabase';
import { VRMAvatar } from '@/components/vrm/VRMAvatar';
import { cn } from '@/lib/utils';
import type { StreamerStatus } from '@gleamers/shared';

interface PageProps {
  params: { slug: string };
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

export default async function StreamerPage({ params }: PageProps) {
  const sb = createSupabaseServer();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select(
      'id, name, slug, owner_wallet, status, avatar_vrm_url, personality_config',
    )
    .eq('slug', params.slug)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!streamer) {
    notFound();
  }

  const vrmUrl = streamer.avatar_vrm_url || '/demo.vrm';

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
            <h1 className="mt-1 text-2xl font-semibold sm:text-3xl">
              {streamer.name}
            </h1>
            <p className="text-sm text-muted-foreground">
              Deployed by{' '}
              <code className="font-mono text-xs">
                {truncateWallet(streamer.owner_wallet)}
              </code>
            </p>
          </div>

          <span
            className={cn(
              'inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs font-medium',
              STATUS_STYLE[streamer.status],
            )}
          >
            <span className="size-2 rounded-full bg-current" />
            {STATUS_LABEL[streamer.status]}
          </span>
        </header>

        <div className="grid flex-1 gap-4 lg:grid-cols-3">
          <section className="relative min-h-[420px] overflow-hidden rounded-xl border border-border bg-card lg:col-span-2">
            <VRMAvatar vrmUrl={vrmUrl} isSleeping={streamer.status !== 'LIVE'} />
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

export const dynamic = 'force-dynamic';
