import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { createSupabaseServer } from '@/lib/supabase';
import StreamerClient from './StreamerClient';

interface PageProps {
  params: { slug: string };
}

export async function generateMetadata({
  params,
}: PageProps): Promise<Metadata> {
  let name = params.slug;
  let status: string | null = null;
  try {
    const sb = createSupabaseServer();
    const { data } = await sb
      .from('streamers')
      .select('name, status')
      .eq('slug', params.slug)
      .maybeSingle();
    if (data) {
      name = data.name;
      status = data.status;
    }
  } catch {
    /* noop — metadata falls back to defaults */
  }
  const title =
    status === 'LIVE'
      ? `${name} — Live on Gleamers`
      : `${name} — Gleamers`;
  const description =
    status === 'LIVE'
      ? `${name} is streaming right now. Chat is open to everyone.`
      : `AI VTuber on Gleamers. Deployed on-chain, chat open to everyone.`;
  const ogImage = `/api/og/${encodeURIComponent(params.slug)}`;
  return {
    title,
    description,
    openGraph: {
      title,
      description,
      type: 'website',
      images: [{ url: ogImage, width: 1200, height: 630, alt: name }],
    },
    twitter: {
      card: 'summary_large_image',
      title,
      description,
      images: [ogImage],
    },
  };
}

interface WsInfo {
  workerPort: number;
  sessionId: string;
  sessionType?: 'debut' | 'normal' | 'revival';
  endsAt: string;
}

async function fetchWsInfo(
  slug: string,
  baseUrl: string,
): Promise<WsInfo | null> {
  try {
    const url = `${baseUrl.replace(/\/$/, '')}/streamers/${encodeURIComponent(slug)}/ws-info`;
    const res = await fetch(url, { cache: 'no-store' });
    if (res.status === 404) return null;
    if (!res.ok) {
      console.warn(`ws-info ${slug}: ${res.status}`);
      return null;
    }
    return (await res.json()) as WsInfo;
  } catch (err) {
    console.warn('ws-info fetch failed', err);
    return null;
  }
}

export default async function StreamerPage({ params }: PageProps) {
  const sb = createSupabaseServer();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select('id, name, slug, owner_wallet, status, ready_at, avatar_vrm_url')
    .eq('slug', params.slug)
    .maybeSingle();

  if (error) throw error;
  if (!streamer) notFound();

  const orchestratorUrl =
    process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ?? 'http://localhost:4000';
  const publicWsBase =
    process.env.NEXT_PUBLIC_ORCHESTRATOR_WS_URL ??
    orchestratorUrl.replace(/^http/, 'ws');

  const wsInfo =
    streamer.status === 'LIVE'
      ? await fetchWsInfo(params.slug, orchestratorUrl)
      : null;

  // If the worker is routed through the orchestrator proxy, use the
  // public `/ws/:slug` route instead of pointing at the worker's port
  // directly (viewers can't reach the worker ports from the outside).
  const wsUrl = wsInfo
    ? `${publicWsBase.replace(/\/$/, '')}/ws/${encodeURIComponent(params.slug)}`
    : null;

  return (
    <StreamerClient
      streamer={streamer}
      wsUrl={wsUrl}
      wsInfo={wsInfo}
    />
  );
}

export const dynamic = 'force-dynamic';
