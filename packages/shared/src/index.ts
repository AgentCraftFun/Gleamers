// ---------------------------------------------------------------------------
// Enums / constants
// ---------------------------------------------------------------------------

export type StreamerStatus = 'LIVE' | 'COOLING_DOWN' | 'READY' | 'OFFLINE';

export const SuperChatTier = {
  TIER_1: 1,
  TIER_2: 2,
  TIER_3: 3,
} as const;
export type SuperChatTier =
  (typeof SuperChatTier)[keyof typeof SuperChatTier];

export type SessionType = 'debut' | 'normal' | 'revival';
export type SessionEndReason =
  | 'timer'
  | 'crash'
  | 'platform_stop'
  | 'revival_timer';

export type LoreType =
  | 'catchphrase'
  | 'chatter_relationship'
  | 'inside_joke'
  | 'arc'
  | 'opinion'
  | 'super_chat_supporter';

export type ModerationEventType =
  | 'input_blocked'
  | 'output_blocked'
  | 'output_regenerated'
  | 'super_chat_blocked';

export type PaymentEventType = 'super_chat' | 'deploy_fee';
export type PaymentStatus = 'pending' | 'confirmed' | 'failed';

export type PendingDeployStatus =
  | 'awaiting_payment'
  | 'paid'
  | 'finalized'
  | 'abandoned';

// ---------------------------------------------------------------------------
// DB row shapes (snake_case, mirroring Supabase)
// ---------------------------------------------------------------------------

export type PersonalityConfig = {
  system_prompt: string;
  tags: string[];
  safe_mode?: boolean;
  [key: string]: unknown;
};

export type UserRow = {
  id: string;
  wallet_address: string | null;
  anonymous_id: string | null;
  display_name: string | null;
  created_at: string;
  token_balance_cached: string;
  token_balance_updated_at: string | null;
  is_admin: boolean;
};

export type StreamerRow = {
  id: string;
  owner_id: string;
  owner_wallet: string;
  name: string;
  slug: string;
  personality_config: PersonalityConfig;
  voice_id: string;
  avatar_vrm_url: string;
  thumbnail_url: string | null;
  status: StreamerStatus;
  current_session_id: string | null;
  ready_at: string | null;
  last_session_ended_at: string | null;
  total_sessions: number;
  revival_count_today: number;
  revival_count_reset_at: string | null;
  deploy_tx_hash: string | null;
  deploy_fee_paid: string;
  total_super_chat_earnings: string;
  created_at: string;
  last_active_at: string | null;
};

export type SessionRow = {
  id: string;
  streamer_id: string;
  started_at: string;
  scheduled_end_at: string;
  ended_at: string | null;
  end_reason: SessionEndReason | null;
  session_type: SessionType;
  summary: string | null;
  transcript_url: string | null;
  peak_viewers: number;
  total_messages: number;
  total_super_chats: number;
  total_super_chat_revenue: string;
};

export type ChatMessageRow = {
  id: string;
  session_id: string;
  user_id: string | null;
  content: string;
  was_noticed: boolean;
  ai_response_id: string | null;
  sender_token_balance: string | null;
  is_super_chat: boolean;
  super_chat_tier: SuperChatTier | null;
  super_chat_amount: string | null;
  super_chat_tx_hash: string | null;
  super_chat_verified: boolean;
  super_chat_pinned_until: string | null;
  super_chat_addressed_at: string | null;
  created_at: string;
};

export type AiResponseRow = {
  id: string;
  session_id: string;
  content: string;
  triggered_by_chat_ids: string[] | null;
  model_used: string | null;
  created_at: string;
};

export type StreamerLoreRow = {
  id: string;
  streamer_id: string;
  lore_type: LoreType;
  content: string;
  metadata: Record<string, unknown>;
  relevance_score: number;
  created_at: string;
};

export type ModerationEventRow = {
  id: string;
  event_type: ModerationEventType;
  session_id: string | null;
  user_id: string | null;
  content_snippet: string | null;
  reason: string | null;
  created_at: string;
};

export type PaymentEventRow = {
  id: string;
  event_type: PaymentEventType;
  tx_hash: string;
  from_wallet: string;
  amount: string;
  streamer_id: string | null;
  chat_message_id: string | null;
  owner_payout: string | null;
  treasury_share: string | null;
  burn_amount: string | null;
  treasury_amount: string | null;
  status: PaymentStatus | null;
  confirmed_at: string | null;
  created_at: string;
};

export type PendingDeployRow = {
  id: string;
  user_id: string;
  personality_config: PersonalityConfig;
  voice_id: string;
  avatar_vrm_url: string;
  proposed_name: string;
  proposed_slug: string;
  status: PendingDeployStatus;
  tx_hash: string | null;
  created_at: string;
  expires_at: string;
};

export type PendingSuperChatStatus =
  | 'awaiting_tx'
  | 'confirmed'
  | 'failed'
  | 'abandoned';

export type PendingSuperChatRow = {
  id: string;
  streamer_id: string;
  session_id: string;
  user_id: string;
  tier: SuperChatTier;
  tier_amount: string;
  message: string;
  message_hash: string;
  streamer_id_bytes32: string;
  streamer_owner: string;
  status: PendingSuperChatStatus;
  tx_hash: string | null;
  finalized_at: string | null;
  chat_message_id: string | null;
  payment_event_id: string | null;
  created_at: string;
  expires_at: string;
};

// ---------------------------------------------------------------------------
// Supabase Database schema (for @supabase/supabase-js generic)
// ---------------------------------------------------------------------------

// Keys whose value type includes null (treated as optional on insert).
type NullableKeys<T> = {
  [K in keyof T]: null extends T[K] ? K : never;
}[keyof T];

type InsertOf<Row, Defaulted extends keyof Row = never> = Omit<
  Row,
  NullableKeys<Row> | Defaulted
> &
  Partial<Pick<Row, NullableKeys<Row> | Defaulted>>;

type TableDef<Row, Insert = Row, Update = Partial<Row>> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: [];
};

export type Database = {
  public: {
    Tables: {
      users: TableDef<
        UserRow,
        InsertOf<
          UserRow,
          | 'id'
          | 'created_at'
          | 'token_balance_cached'
          | 'is_admin'
        >
      >;
      streamers: TableDef<
        StreamerRow,
        InsertOf<
          StreamerRow,
          | 'id'
          | 'created_at'
          | 'status'
          | 'total_sessions'
          | 'revival_count_today'
          | 'deploy_fee_paid'
          | 'total_super_chat_earnings'
        >
      >;
      sessions: TableDef<
        SessionRow,
        InsertOf<
          SessionRow,
          | 'id'
          | 'started_at'
          | 'peak_viewers'
          | 'total_messages'
          | 'total_super_chats'
          | 'total_super_chat_revenue'
          | 'session_type'
        >
      >;
      chat_messages: TableDef<
        ChatMessageRow,
        InsertOf<
          ChatMessageRow,
          | 'id'
          | 'created_at'
          | 'was_noticed'
          | 'is_super_chat'
          | 'super_chat_verified'
        >
      >;
      ai_responses: TableDef<
        AiResponseRow,
        InsertOf<AiResponseRow, 'id' | 'created_at'>
      >;
      streamer_lore: TableDef<
        StreamerLoreRow,
        InsertOf<
          StreamerLoreRow,
          'id' | 'created_at' | 'metadata' | 'relevance_score'
        >
      >;
      moderation_events: TableDef<
        ModerationEventRow,
        InsertOf<ModerationEventRow, 'id' | 'created_at'>
      >;
      payment_events: TableDef<
        PaymentEventRow,
        InsertOf<PaymentEventRow, 'id' | 'created_at'>
      >;
      pending_deploys: TableDef<
        PendingDeployRow,
        InsertOf<
          PendingDeployRow,
          'id' | 'created_at' | 'expires_at' | 'status'
        >
      >;
      pending_super_chats: TableDef<
        PendingSuperChatRow,
        InsertOf<
          PendingSuperChatRow,
          'id' | 'created_at' | 'expires_at' | 'status'
        >
      >;
    };
    Views: Record<string, never>;
    Functions: Record<string, never>;
  };
};

// ---------------------------------------------------------------------------
// Domain helpers (camelCase view models for the client)
// ---------------------------------------------------------------------------

export interface SuperChatTierInfo {
  tier: SuperChatTier;
  pinnedForSeconds: number;
  priority: 'low' | 'medium' | 'top';
}

export const SUPER_CHAT_TIERS: Record<SuperChatTier, SuperChatTierInfo> = {
  1: { tier: SuperChatTier.TIER_1, pinnedForSeconds: 180, priority: 'low' },
  2: { tier: SuperChatTier.TIER_2, pinnedForSeconds: 600, priority: 'medium' },
  3: { tier: SuperChatTier.TIER_3, pinnedForSeconds: 1800, priority: 'top' },
};

/**
 * Max length of a super-chat message. Matches the on-chain receipt
 * size target and keeps tier 3 cards from overflowing the panel.
 */
export const SUPER_CHAT_MAX_CHARS = 200;

/**
 * When a Tier 3 super chat is addressed by the streamer, the pin is
 * extended this many seconds beyond the acknowledgement timestamp.
 */
export const SUPER_CHAT_TIER3_POST_ADDRESS_SECONDS = 300;

export interface SuperChatTierCopy {
  name: string;
  pinBlurb: string;
  priorityBlurb: string;
}

export const SUPER_CHAT_TIER_COPY: Record<SuperChatTier, SuperChatTierCopy> = {
  1: {
    name: 'Tier 1',
    pinBlurb: 'Pinned 3 min',
    priorityBlurb: 'Seen soon',
  },
  2: {
    name: 'Tier 2',
    pinBlurb: 'Pinned 10 min',
    priorityBlurb: 'Priority response',
  },
  3: {
    name: 'Tier 3',
    pinBlurb: 'Pinned until addressed',
    priorityBlurb: 'Top priority',
  },
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

// ---------------------------------------------------------------------------
// Worker <-> Web WebSocket protocol
// ---------------------------------------------------------------------------

export type WorkerExpression =
  | 'happy'
  | 'angry'
  | 'surprised'
  | 'thinking'
  | 'laughing'
  | 'neutral';

export interface WorkerAudioFormat {
  sampleRate: number;
  encoding: 'pcm_s16le';
  channels: 1;
}

export type WorkerFrame =
  | {
      type: 'hello';
      sessionId: string;
      slug: string;
      streamerName: string;
      avatarVrmUrl: string;
      audioFormat: WorkerAudioFormat;
      endsAt: string;
      timestamp: number;
    }
  | {
      type: 'response_start';
      responseId: string;
      timestamp: number;
    }
  | {
      type: 'audio_chunk';
      responseId: string;
      data: string; // base64 PCM s16le
      timestamp: number;
    }
  | {
      type: 'response_end';
      responseId: string;
      timestamp: number;
    }
  | {
      type: 'text';
      content: string;
      responseId: string;
      sentenceIndex: number;
      timestamp: number;
    }
  | {
      type: 'expression';
      expression: WorkerExpression;
      timestamp: number;
    }
  | {
      type: 'session_info';
      endsAt: string;
      secondsRemaining: number;
      timestamp: number;
    }
  | {
      type: 'session_ending';
      reason: 'timer' | 'crash' | 'platform_stop' | 'revival_timer';
      timestamp: number;
    }
  | {
      type: 'message_noticed';
      messageId: string;
      timestamp: number;
    }
  | {
      type: 'super_chat_addressed';
      messageId: string;
      tier: SuperChatTier;
      timestamp: number;
    };

// ---------------------------------------------------------------------------
// Redis pub/sub envelope: chat:<slug>
// ---------------------------------------------------------------------------

export interface ChatPublishEnvelope {
  messageId: string;
  sessionId: string;
  slug: string;
  userId: string;
  displayName: string;
  content: string;
  senderTokenBalance: string;
  isSuperChat: boolean;
  superChatTier?: SuperChatTier;
  createdAt: string;
}

export const CHAT_CHANNEL_PREFIX = 'chat:';
