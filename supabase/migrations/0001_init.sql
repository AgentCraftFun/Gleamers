-- Gleamers initial schema
-- Tables: users, streamers, sessions, chat_messages, ai_responses,
--         streamer_lore, moderation_events, payment_events,
--         pending_deploys.

create extension if not exists "pgcrypto";

-- ---------------------------------------------------------------------------
-- users
-- ---------------------------------------------------------------------------
create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  wallet_address text unique,
  anonymous_id text unique,
  display_name text,
  created_at timestamptz not null default now(),
  token_balance_cached numeric not null default 0,
  token_balance_updated_at timestamptz,
  is_admin boolean not null default false
);

-- ---------------------------------------------------------------------------
-- streamers
-- ---------------------------------------------------------------------------
create table if not exists streamers (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references users(id),
  owner_wallet text not null,
  name text not null,
  slug text unique not null,
  personality_config jsonb not null,
  voice_id text not null,
  avatar_vrm_url text not null,
  thumbnail_url text,

  status text not null default 'OFFLINE'
    check (status in ('LIVE','COOLING_DOWN','READY','OFFLINE')),
  current_session_id uuid,
  ready_at timestamptz,
  last_session_ended_at timestamptz,
  total_sessions int not null default 0,
  revival_count_today int not null default 0,
  revival_count_reset_at timestamptz,

  deploy_tx_hash text,
  deploy_fee_paid numeric not null default 0,

  total_super_chat_earnings numeric not null default 0,

  created_at timestamptz not null default now(),
  last_active_at timestamptz
);

create index if not exists streamers_live_idx
  on streamers (status)
  where status = 'LIVE';

create index if not exists streamers_cooling_idx
  on streamers (status, ready_at)
  where status = 'COOLING_DOWN';

create index if not exists streamers_owner_idx
  on streamers (owner_id);

-- ---------------------------------------------------------------------------
-- sessions
-- ---------------------------------------------------------------------------
create table if not exists sessions (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references streamers(id),
  started_at timestamptz not null default now(),
  scheduled_end_at timestamptz not null,
  ended_at timestamptz,
  end_reason text check (end_reason in
    ('timer','crash','platform_stop','revival_timer')),
  session_type text not null default 'normal'
    check (session_type in ('debut','normal','revival')),
  summary text,
  transcript_url text,
  peak_viewers int not null default 0,
  total_messages int not null default 0,
  total_super_chats int not null default 0,
  total_super_chat_revenue numeric not null default 0
);

create index if not exists sessions_streamer_started_idx
  on sessions (streamer_id, started_at desc);

-- Back-link for streamers.current_session_id (deferrable to allow
-- circular creation in a single transaction)
alter table streamers
  add constraint streamers_current_session_fk
  foreign key (current_session_id) references sessions(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- chat_messages
-- ---------------------------------------------------------------------------
create table if not exists chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  user_id uuid references users(id),
  content text not null,
  was_noticed boolean not null default false,
  ai_response_id uuid,
  sender_token_balance numeric,

  is_super_chat boolean not null default false,
  super_chat_tier int check (super_chat_tier in (1,2,3)),
  super_chat_amount numeric,
  super_chat_tx_hash text,
  super_chat_verified boolean not null default false,
  super_chat_pinned_until timestamptz,
  super_chat_addressed_at timestamptz,

  created_at timestamptz not null default now()
);

create index if not exists chat_messages_session_created_idx
  on chat_messages (session_id, created_at);

create index if not exists chat_messages_super_pinned_idx
  on chat_messages (session_id, is_super_chat, super_chat_pinned_until)
  where is_super_chat = true;

-- ---------------------------------------------------------------------------
-- ai_responses
-- ---------------------------------------------------------------------------
create table if not exists ai_responses (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references sessions(id),
  content text not null,
  triggered_by_chat_ids uuid[],
  model_used text,
  created_at timestamptz not null default now()
);

alter table chat_messages
  add constraint chat_messages_ai_response_fk
  foreign key (ai_response_id) references ai_responses(id)
  on delete set null;

-- ---------------------------------------------------------------------------
-- streamer_lore
-- ---------------------------------------------------------------------------
create table if not exists streamer_lore (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references streamers(id),
  lore_type text check (lore_type in
    ('catchphrase','chatter_relationship','inside_joke','arc',
     'opinion','super_chat_supporter')),
  content text not null,
  metadata jsonb not null default '{}'::jsonb,
  relevance_score double precision not null default 1.0,
  created_at timestamptz not null default now()
);

create index if not exists streamer_lore_relevance_idx
  on streamer_lore (streamer_id, relevance_score desc);

-- ---------------------------------------------------------------------------
-- moderation_events
-- ---------------------------------------------------------------------------
create table if not exists moderation_events (
  id uuid primary key default gen_random_uuid(),
  event_type text check (event_type in
    ('input_blocked','output_blocked','output_regenerated',
     'super_chat_blocked')),
  session_id uuid references sessions(id),
  user_id uuid references users(id),
  content_snippet text,
  reason text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- payment_events
-- ---------------------------------------------------------------------------
create table if not exists payment_events (
  id uuid primary key default gen_random_uuid(),
  event_type text not null check (event_type in ('super_chat','deploy_fee')),
  tx_hash text unique not null,
  from_wallet text not null,
  amount numeric not null,
  streamer_id uuid references streamers(id),
  chat_message_id uuid references chat_messages(id),
  owner_payout numeric,
  treasury_share numeric,
  burn_amount numeric,
  treasury_amount numeric,
  status text check (status in ('pending','confirmed','failed')),
  confirmed_at timestamptz,
  created_at timestamptz not null default now()
);

create index if not exists payment_events_streamer_created_idx
  on payment_events (streamer_id, created_at desc);

-- ---------------------------------------------------------------------------
-- pending_deploys
-- ---------------------------------------------------------------------------
create table if not exists pending_deploys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id),
  personality_config jsonb not null,
  voice_id text not null,
  avatar_vrm_url text not null,
  proposed_name text not null,
  proposed_slug text not null,
  status text not null default 'awaiting_payment'
    check (status in ('awaiting_payment','paid','finalized','abandoned')),
  tx_hash text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '1 hour')
);

create index if not exists pending_deploys_user_status_idx
  on pending_deploys (user_id, status);
