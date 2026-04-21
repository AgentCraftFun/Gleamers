-- Pending super-chat intents.
--
-- Lifecycle:
--   awaiting_tx  — /api/super-chat/prepare inserted this row, user now
--                  sending approve + superChat transactions
--   confirmed    — /api/super-chat/submit verified the tx on chain and
--                  wrote chat_messages + payment_events
--   failed       — verification rejected; also covers chain revert
--   abandoned    — expires_at passed without a tx hash ever arriving

create table if not exists pending_super_chats (
  id uuid primary key default gen_random_uuid(),
  streamer_id uuid not null references streamers(id),
  session_id uuid not null references sessions(id),
  user_id uuid not null references users(id),
  tier int not null check (tier in (1,2,3)),
  tier_amount numeric not null,
  message text not null,
  message_hash text not null,
  streamer_id_bytes32 text not null,
  streamer_owner text not null,
  status text not null default 'awaiting_tx'
    check (status in ('awaiting_tx','confirmed','failed','abandoned')),
  tx_hash text,
  finalized_at timestamptz,
  chat_message_id uuid references chat_messages(id),
  payment_event_id uuid references payment_events(id),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default (now() + interval '30 minutes')
);

create index if not exists pending_super_chats_user_status_idx
  on pending_super_chats (user_id, status);

create index if not exists pending_super_chats_tx_hash_idx
  on pending_super_chats (tx_hash)
  where tx_hash is not null;
