-- Deploy flow: fee snapshot + waitlist table.
--
-- pending_deploys.deploy_fee_amount snapshots the tier amount at
-- prepare-time so verification is robust to admin fee changes.
-- pending_deploys.pending_id_bytes32 is the opaque deployId the
-- client passes to PAYMENTS.payDeployFee(); it's the UUID packed
-- into 32 bytes.

alter table pending_deploys
  add column if not exists deploy_fee_amount numeric not null default 0;

alter table pending_deploys
  add column if not exists pending_id_bytes32 text;

alter table pending_deploys
  add column if not exists streamer_id uuid references streamers(id);

alter table pending_deploys
  add column if not exists payment_event_id uuid references payment_events(id);

-- Ensure status covers post-fee states.
alter table pending_deploys
  drop constraint if exists pending_deploys_status_check;

alter table pending_deploys
  add constraint pending_deploys_status_check
  check (status in ('awaiting_payment','paid','finalized','abandoned','failed'));

-- Lightweight waitlist capture. Used only when TOKEN_LIVE=false and
-- a non-admin visits /deploy.
create table if not exists waitlist_emails (
  id uuid primary key default gen_random_uuid(),
  email text not null unique,
  wallet_address text,
  source text not null default 'deploy_gate',
  created_at timestamptz not null default now()
);

create index if not exists waitlist_emails_created_idx
  on waitlist_emails (created_at desc);
