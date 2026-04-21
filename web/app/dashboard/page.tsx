import { redirect } from 'next/navigation';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { Header } from '@/components/home/Header';
import { DashboardClient } from './DashboardClient';
import type { DashboardStreamer } from './types';

export const dynamic = 'force-dynamic';

const STREAMER_COLS =
  'id, slug, name, status, avatar_vrm_url, thumbnail_url, ready_at, total_sessions, total_super_chat_earnings, current_session_id, last_session_ended_at, created_at';

export default async function DashboardPage() {
  const session = await readSession();
  if (!session) redirect('/');

  const tokenLive = process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
  const sb = createSupabaseAdmin();

  const { data: streamers, error } = await sb
    .from('streamers')
    .select(STREAMER_COLS)
    .eq('owner_id', session.userId)
    .order('created_at', { ascending: false });
  if (error) throw error;

  const rows: DashboardStreamer[] = [];
  for (const s of streamers ?? []) {
    let currentSession: DashboardStreamer['currentSession'] = null;
    if (s.current_session_id) {
      const { data: cur } = await sb
        .from('sessions')
        .select('id, scheduled_end_at')
        .eq('id', s.current_session_id)
        .maybeSingle();
      if (cur) {
        currentSession = {
          id: cur.id,
          scheduledEndAt: cur.scheduled_end_at,
        };
      }
    }
    const { data: last } = await sb
      .from('sessions')
      .select(
        'id, started_at, ended_at, peak_viewers, total_messages, total_super_chats, total_super_chat_revenue, session_type',
      )
      .eq('streamer_id', s.id)
      .not('ended_at', 'is', null)
      .order('started_at', { ascending: false })
      .limit(1)
      .maybeSingle();

    rows.push({
      id: s.id,
      slug: s.slug,
      name: s.name,
      status: s.status,
      avatar_vrm_url: s.avatar_vrm_url,
      thumbnail_url: s.thumbnail_url,
      ready_at: s.ready_at,
      total_sessions: s.total_sessions,
      total_super_chat_earnings: s.total_super_chat_earnings,
      last_session_ended_at: s.last_session_ended_at,
      created_at: s.created_at,
      currentSession,
      lastSession: last
        ? {
            id: last.id,
            startedAt: last.started_at,
            endedAt: last.ended_at,
            peakViewers: last.peak_viewers,
            totalMessages: last.total_messages,
            totalSuperChats: last.total_super_chats,
            totalSuperChatRevenue: last.total_super_chat_revenue ?? '0',
            sessionType: last.session_type,
          }
        : null,
    });
  }

  return (
    <div className="min-h-screen bg-background">
      <Header tokenLive={tokenLive} />
      <DashboardClient
        walletAddress={session.walletAddress}
        streamers={rows}
      />
    </div>
  );
}
