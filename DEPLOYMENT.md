# Gleamers deployment guide

Prereqs: a Supabase project, an Upstash (or any) Redis, Anthropic +
Cartesia API keys, Alchemy key, and a funded deployer wallet on Base
(Sepolia first, mainnet second).

## 1. Supabase

### Database

```bash
export SUPABASE_DB_URL="postgres://..."   # from Supabase Dashboard → Database → Connection string
pnpm db:migrate
```

This runs `supabase/migrations/00{01,02,03}*.sql` in order. Re-running
is idempotent — every object is created `IF NOT EXISTS`.

### Storage buckets

Create these in Supabase Dashboard → Storage → New Bucket, **both
public**:

- `avatars` — VRM uploads from `POST /api/avatar/upload`
- `transcripts` — session transcripts written at worker shutdown

### Realtime

Enable realtime for the tables the web client subscribes to:
Dashboard → Database → Replication → enable for

- `streamers` (homepage status moves, dashboard refreshes)
- `chat_messages` (chat panel INSERT + UPDATE)

### Seed

```bash
# from repo root, with SUPABASE_URL, SUPABASE_SERVICE_KEY, ADMIN_WALLETS set
pnpm db:seed
```

Seeds one admin user from `ADMIN_WALLETS[0]` + two starter streamers
(Mika, Marcus) in `READY`.

## 2. Upstash Redis

Create a Redis instance. Paste the `redis://…` connection string into
`REDIS_URL` for both the orchestrator and worker. The web app uses
Redis for rate-limit counters + chat pub/sub — optional but
strongly recommended once you have real traffic (falls back to
in-memory otherwise).

## 3. Payments contract (skip until token launch)

See `contracts/README.md`. Summary:

```bash
cd contracts
forge install
forge test                         # must pass clean
forge script script/Deploy.s.sol:DeployPayments \
  --rpc-url base_sepolia \
  --private-key $DEPLOYER_PK \
  --broadcast --verify
# then, from the deployer wallet, set tier amounts + deploy fee:
cast send $PAYMENTS "setTierAmount(uint8,uint256)" 1 <tier1_wei> --private-key ...
cast send $PAYMENTS "setTierAmount(uint8,uint256)" 2 <tier2_wei> --private-key ...
cast send $PAYMENTS "setTierAmount(uint8,uint256)" 3 <tier3_wei> --private-key ...
cast send $PAYMENTS "setDeployFee(uint256)" <fee_wei> --private-key ...
```

Mainnet: repeat with `--rpc-url base`. Keep `TOKEN_LIVE=false` in
production until tier amounts and deploy fee are verified on-chain.

## 4. Web (Vercel)

```bash
# In the Vercel project settings:
# - Root directory: web
# - Build command:   pnpm --filter web build (or default Next build)
# - Output: .next
```

Environment variables (web):

| Key | Required | Notes |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | ✓ | |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | ✓ | browser reads |
| `SUPABASE_SERVICE_KEY` | ✓ | **server only**; never expose |
| `NEXT_PUBLIC_ORCHESTRATOR_URL` | ✓ | public-routable orch URL |
| `NEXT_PUBLIC_ORCHESTRATOR_WS_URL` | | defaults to `ws://…` of the above |
| `ORCHESTRATOR_API_KEY` | ✓ | match orchestrator env |
| `REDIS_URL` | | rate limits + chat pub/sub |
| `AUTH_SECRET` | ✓ | 32+ bytes |
| `NEXT_PUBLIC_TOKEN_LIVE` | ✓ | `false` until launch |
| `NEXT_PUBLIC_TOKEN_ADDRESS` | when `TOKEN_LIVE=true` | ERC-20 on Base |
| `NEXT_PUBLIC_PAYMENTS_ADDRESS` | when `TOKEN_LIVE=true` | Payments contract |
| `NEXT_PUBLIC_CHAIN_ID` | ✓ | `8453` (mainnet) or `84532` (sepolia) |
| `NEXT_PUBLIC_ALCHEMY_KEY` | ✓ | |
| `NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID` | | only needed if users pick WC in RainbowKit |
| `ADMIN_WALLETS` | ✓ | comma-separated, lowercase |
| `OPENAI_API_KEY` | | moderation layer; no-op without |
| `NEXT_PUBLIC_POSTHOG_KEY` | | analytics; no-op without |
| `NEXT_PUBLIC_POSTHOG_HOST` | | defaults to `https://us.i.posthog.com` |
| `NEXT_PUBLIC_SITE_URL` | | canonical URL for og/sitemap/robots |

## 5. Orchestrator (Fly.io)

One instance handles roughly 50-100 concurrent streamers — the
orchestrator spawns each worker as a child process in its own VM.
Scale the VM; don't run multiple orchestrators unless you front
them with sticky routing.

```bash
# fly.toml
# app = "gleamers-orchestrator"
# [[services]]
#   internal_port = 4000
#   protocol      = "tcp"
#   processes     = ["app"]
#   [[services.ports]]
#     port = 443
#     handlers = ["tls", "http"]
# [[services.tcp_checks]]
#   interval = "15s"
#   port     = 4000

pnpm --filter orchestrator build
fly deploy
```

Environment variables (orchestrator):

| Key | Required | Notes |
|---|---|---|
| `PORT` | | defaults to 4000 |
| `SUPABASE_URL` | ✓ | |
| `SUPABASE_SERVICE_KEY` | ✓ | |
| `REDIS_URL` | | speaking-status hash |
| `ORCHESTRATOR_API_KEY` | ✓ | match web env |
| `ANTHROPIC_API_KEY` | ✓ | post-process summary + lore |
| `TOKEN_LIVE` | ✓ | mirror of the web flag |
| `ADMIN_WALLETS` | ✓ | |
| `TREASURY_WALLET` | | informational |
| `REVIVAL_ENABLED` | | defaults `true` |
| `REVIVAL_MIN_LIVE_THRESHOLD` | | defaults `3` |
| `REVIVAL_MAX_PER_DAY_PER_STREAMER` | | defaults `1` |
| `REVIVAL_CHECK_INTERVAL_MS` | | defaults `300000` |

The orchestrator spawns the worker binary it finds at
`../worker/dist/session.js` (relative to its cwd). Either ship both
packages together or override with `WORKER_CMD` / `WORKER_ARGS` /
`WORKER_CWD`.

### Worker env (inherited from orchestrator spawn)

The orchestrator passes `STREAMER_SLUG`, `SESSION_ID`, `SESSION_TYPE`,
`WORKER_PORT` itself. The worker also needs these from the
orchestrator's environment:

| Key | Notes |
|---|---|
| `ANTHROPIC_API_KEY` | Claude Haiku (brain, output moderator) |
| `CARTESIA_API_KEY` | TTS |
| `SUPABASE_URL` + `SUPABASE_SERVICE_KEY` | DB writes |
| `REDIS_URL` | chat subscriber + speaking publisher |
| `ORCHESTRATOR_API_KEY` | to hit `/sessions/:id/post-process` |
| `TOKEN_LIVE` | chat score weighting |
| `OUTPUT_MODERATION` | set `false` to disable per-sentence moderator |

## 6. TOKEN_LIVE flip procedure

Strict order — don't skip steps:

1. **Deploy token contract** on Base (whatever ERC-20 you're using).
   Confirm it's verified on Basescan.
2. **Deploy Payments** with the token address baked into the
   constructor (see `contracts/`). Verify on Basescan.
3. **Configure the contract** from the admin wallet:
   - `setTierAmount(1, ...)`, `setTierAmount(2, ...)`, `setTierAmount(3, ...)`
   - `setDeployFee(...)`
   - `setTreasury(...)` if the treasury differs from the constructor
4. **Verify end-to-end on Base Sepolia first**: admin deploy, fee-path
   deploy, tier 1/2/3 super chats, reconcile flow.
5. **Update env vars** on web + orchestrator:
   - `NEXT_PUBLIC_TOKEN_ADDRESS=<mainnet token>`
   - `NEXT_PUBLIC_PAYMENTS_ADDRESS=<mainnet Payments>`
   - `NEXT_PUBLIC_CHAIN_ID=8453`
   - `NEXT_PUBLIC_TOKEN_LIVE=true`
   - `TOKEN_LIVE=true` (orchestrator)
6. **Redeploy** web + orchestrator.

Rollback: flip `TOKEN_LIVE=false` on both services, redeploy. Super
chats and fee-path deploys stop immediately (server returns 503
`token_not_live`); chat stays open, admin allowlist keeps working.

## 7. Day-2 ops

- `/admin` (is_admin gated) shows live/cooling/ready counts, 24h +
  lifetime revenue/burn/treasury, top streamers, recent on-chain
  events.
- Orchestrator `/health` returns the active revival config.
- Worker `/health` (port `WORKER_PORT + 1000`) reports session + viewer
  counts + secondsUntilEnd.
- Daily lore decay runs at 03:00 UTC; find it in the orchestrator
  logs as `[decay] ran: decayed=… pruned=…`.
- Post-process failures log with `[post-process]` prefix — no retry
  queue in MVP; re-run manually by POSTing the same session id.
- Blocklist: edit `config/blocklist.json` and save. Hot-reloaded
  within 2s on the next request.

## 8. Security / abuse audit checklist

- Rate limits: per-user 5/10s burst + 20/5min sustained; per-IP
  50/5min. Anonymous and wallet-connected share the same limits.
- Deploy gating: validated server-side in
  `POST /api/streamers/create-admin` (admin session required) and
  `POST /api/streamers/create-prepare` (TOKEN_LIVE + wallet session).
- Super-chat tx verification: `lib/super-chat/finalize.ts` rejects on
  duplicate tx_hash, asserts `receipt.to === Payments`, checks every
  SuperChat event arg (tier, amount, messageHash, streamerId, owner).
- Deploy-fee tx verification: same guards in
  `lib/deploy/finalize.ts`.
- `ORCHESTRATOR_API_KEY` required on every write endpoint; 503
  fail-closed when unset.
- `SUPABASE_SERVICE_KEY` is only used inside
  `createSupabaseAdmin()` which runs in server-only code paths.
- No dynamic SQL composition on user input; every query goes through
  supabase-js parameterisation.
- Output moderation: per-sentence Haiku YES/NO call; 3 flagged in a
  response aborts generation and swaps the next turn to monologue.

## 9. Feature flag semantics

| Flag | `false` | `true` |
|---|---|---|
| `TOKEN_LIVE` | deploys admin-only, free; super-chat UI shows "coming soon"; chat open to all | any wallet deploys (pay fee, admin bypass); super chats active |
| `REVIVAL_ENABLED` | no auto-spawn when LIVE count is low | every `REVIVAL_CHECK_INTERVAL_MS` the orchestrator promotes up to `REVIVAL_MIN_LIVE_THRESHOLD - liveCount` cooldown streamers to revival sessions |
| `OUTPUT_MODERATION` | per-sentence moderator disabled | Claude Haiku vetoes each sentence before TTS |

Re-read this doc before every flip.
