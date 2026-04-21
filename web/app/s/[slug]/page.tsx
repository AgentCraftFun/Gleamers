import { notFound } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase';
import StreamerClient from './StreamerClient';

interface PageProps {
  params: { slug: string };
}

export default async function StreamerPage({ params }: PageProps) {
  const sb = createSupabaseServer();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select('id, name, slug, owner_wallet, status, avatar_vrm_url')
    .eq('slug', params.slug)
    .maybeSingle();

  if (error) {
    throw error;
  }
  if (!streamer) {
    notFound();
  }

  // Hardcoded worker WS URL for now — orchestrator routing lands in a
  // later prompt. Override per environment via NEXT_PUBLIC_WORKER_WS_URL.
  const workerWsUrl =
    process.env.NEXT_PUBLIC_WORKER_WS_URL ?? 'ws://localhost:5001';

  return <StreamerClient streamer={streamer} workerWsUrl={workerWsUrl} />;
}

export const dynamic = 'force-dynamic';
