import type { StreamerStatus } from '@gleamers/shared';

export interface DashboardLastSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  peakViewers: number;
  totalMessages: number;
  totalSuperChats: number;
  totalSuperChatRevenue: string;
}

export interface DashboardCurrentSession {
  id: string;
  scheduledEndAt: string;
}

export interface DashboardStreamer {
  id: string;
  slug: string;
  name: string;
  status: StreamerStatus;
  avatar_vrm_url: string;
  thumbnail_url: string | null;
  ready_at: string | null;
  total_sessions: number;
  total_super_chat_earnings: string;
  last_session_ended_at: string | null;
  created_at: string;
  currentSession: DashboardCurrentSession | null;
  lastSession: DashboardLastSession | null;
}
