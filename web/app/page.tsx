import { createSupabaseServer } from '@/lib/supabase';
import { Header } from '@/components/home/Header';
import { HomeClient } from '@/components/home/HomeClient';
import type { HomeStreamer } from '@/components/home/types';

export const dynamic = 'force-dynamic';
export const revalidate = 0;

const SELECT =
  'id, slug, name, owner_wallet, status, thumbnail_url, ready_at, last_active_at, current_session_id';

async function safeQuery<T>(
  fn: () => PromiseLike<{ data: T[] | null; error: unknown }>,
): Promise<T[]> {
  try {
    const { data, error } = await fn();
    if (error) {
      console.warn('[home] query error', error);
      return [];
    }
    return data ?? [];
  } catch (err) {
    console.warn('[home] query threw', err);
    return [];
  }
}

export default async function HomePage() {
  const tokenLive = process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';

  let live: HomeStreamer[] = [];
  let cooldown: HomeStreamer[] = [];
  let ready: HomeStreamer[] = [];

  try {
    const sb = createSupabaseServer();
    const [liveRows, cooldownRows, readyRows] = await Promise.all([
      safeQuery<HomeStreamer>(() =>
        sb.from('streamers').select(SELECT).eq('status', 'LIVE'),
      ),
      safeQuery<HomeStreamer>(() =>
        sb
          .from('streamers')
          .select(SELECT)
          .eq('status', 'COOLING_DOWN')
          .order('ready_at', { ascending: true })
          .limit(12),
      ),
      safeQuery<HomeStreamer>(() =>
        sb
          .from('streamers')
          .select(SELECT)
          .eq('status', 'READY')
          .order('last_active_at', { ascending: false, nullsFirst: false })
          .limit(8),
      ),
    ]);
    live = liveRows;
    cooldown = cooldownRows;
    ready = readyRows;
  } catch (err) {
    console.warn('[home] Supabase unavailable, rendering empty state:', err);
  }

  return (
    <div className="min-h-screen bg-background">
      <Header tokenLive={tokenLive} />
      <HomeClient
        tokenLive={tokenLive}
        initial={{ live, cooldown, ready }}
      />
    </div>
  );
}
