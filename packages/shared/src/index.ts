export type StreamerStatus = 'LIVE' | 'COOLING_DOWN' | 'READY' | 'OFFLINE';

export type SuperChatTier = 1 | 2 | 3;

export interface Streamer {
  id: string;
  ownerWallet: string;
  name: string;
  personality: string;
  vrmUrl: string;
  status: StreamerStatus;
  createdAt: string;
  endedAt: string | null;
  readyAt: string | null;
}

export interface Session {
  id: string;
  streamerId: string;
  startedAt: string;
  endsAt: string;
  endedAt: string | null;
  isRevival: boolean;
}

export interface ChatMessage {
  id: string;
  sessionId: string;
  author: string;
  wallet: string | null;
  body: string;
  superChatTier: SuperChatTier | null;
  createdAt: string;
}

export interface SuperChatTierInfo {
  tier: SuperChatTier;
  pinnedForSeconds: number;
  priority: 'low' | 'medium' | 'top';
}

export const SUPER_CHAT_TIERS: Record<SuperChatTier, SuperChatTierInfo> = {
  1: { tier: 1, pinnedForSeconds: 180, priority: 'low' },
  2: { tier: 2, pinnedForSeconds: 600, priority: 'medium' },
  3: { tier: 3, pinnedForSeconds: 300, priority: 'top' },
};

export const SESSION_LENGTH_MS = 60 * 60 * 1000;
export const COOLDOWN_MS = 3 * 60 * 60 * 1000;
export const REVIVAL_CHECK_INTERVAL_MS = 5 * 60 * 1000;
export const REVIVAL_TARGET_LIVE = 3;
export const REVIVAL_MAX_PER_STREAMER_PER_DAY = 1;

export const CHAT_RATE_LIMIT = {
  burstMessages: 5,
  burstWindowMs: 10_000,
  sustainedMessages: 20,
  sustainedWindowMs: 5 * 60_000,
} as const;

export const REVENUE_SPLIT = {
  superChat: { streamerOwnerBps: 9000, treasuryBps: 1000 },
  deployFee: { burnBps: 2000, treasuryBps: 8000 },
} as const;
