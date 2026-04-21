# Gleamers

AI VTuber streaming platform. Token holders deploy AI streamers with
custom personalities and VRM avatars. Each streamer runs 1-hour live
sessions with 3-hour cooldowns. Anyone can chat for free; viewers can
pay the utility token for super chats that guarantee a response.

Reference product: Neuro-sama as a platform.

## Architecture

- **web** — Next.js 14 (App Router) frontend for viewers and deployers
- **worker** — Node.js + Fastify. Runs per-streamer "brain" processes
- **orchestrator** — Node.js + Fastify. Manages worker lifecycle,
  scheduling, cooldowns, featured revival, and WebSocket reverse-proxy
- **contracts** — Foundry project for the Payments smart contract
- **packages/shared** — Shared TypeScript types

## Token modes

The platform supports two modes, gated by `TOKEN_LIVE`:

- **Pre-token (`TOKEN_LIVE=false`)** — admin-allowlist deploys only
  (free), super chats disabled, chat open to everyone
- **Post-token (`TOKEN_LIVE=true`)** — deploys pay a fee (20% burned,
  80% to treasury); super chats active (90% streamer owner, 10%
  treasury); admin allowlist still available as a bypass

## Prerequisites

- Node.js 20+
- pnpm 10+
- (Optional for contracts) Foundry: https://getfoundry.sh
- Supabase project
- Upstash Redis
- Anthropic API key
- Cartesia API key
- Alchemy account with Base mainnet + Base Sepolia keys
- Test wallet with Base Sepolia ETH

## Setup

```bash
pnpm install
cp web/.env.example web/.env.local
cp worker/.env.example worker/.env
cp orchestrator/.env.example orchestrator/.env
```

Fill in the env files with your keys.

## Development

```bash
pnpm dev
```

Boots all three services concurrently:

- web         → http://localhost:3000
- worker      → http://localhost:4001 (health at `/health`)
- orchestrator → http://localhost:4000 (health at `/health`)

## Build

```bash
pnpm build
```

## Repository layout

```
gleamers/
├── web/              # Next.js frontend
├── worker/           # streamer "brain" runner
├── orchestrator/     # scheduling + WS proxy
├── contracts/        # Foundry / Payments.sol
└── packages/
    └── shared/       # shared TS types
```
