/**
 * Per-session worker entry point.
 *
 * Spawned by the orchestrator with env:
 *   STREAMER_SLUG  — the streamer to run
 *   SESSION_ID     — row in sessions to drive
 *   SESSION_TYPE   — 'debut' | 'normal' | 'revival'
 *   WORKER_PORT    — WS port (health at WORKER_PORT + 1000)
 *
 * Lifecycle:
 *  - load streamer + top-20 lore
 *  - open WS server on WORKER_PORT, health HTTP on WORKER_PORT+1000
 *  - broadcast hello frame on connect
 *  - run the monologue loop (8-15s jitter)
 *  - stream audio/text/expression frames as the brain emits them
 *  - emit session_info every 10s
 *  - at scheduled_end_at, emit session_ending{timer}, update DB, exit 0
 *  - on uncaught error: update DB with end_reason='crash', force exit
 */
import { createServer } from 'node:http';
import { WebSocketServer, WebSocket } from 'ws';
import { randomUUID } from 'node:crypto';
import Fastify from 'fastify';

import type {
  StreamerLoreRow,
  StreamerRow,
  WorkerFrame,
  SessionEndReason,
  SessionType,
} from '@gleamers/shared';
import { COOLDOWN_MS } from '@gleamers/shared';

import { getSupabase } from './supabase.js';
import { StreamerBrain } from './brain/streamer-brain.js';
import { SpeakingPublisher } from './brain/speaking-publisher.js';
import { ChatSelector } from './brain/chat-selector.js';
import { ChatSubscriber } from './brain/chat-subscriber.js';
import { SuperChatQueue } from './brain/super-chat-queue.js';
import type { BrainExpression, ChatTrigger } from './brain/types.js';
import {
  SUPER_CHAT_TIER3_POST_ADDRESS_SECONDS,
  SuperChatTier,
  type SuperChatTier as SuperChatTierT,
} from '@gleamers/shared';

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

const STREAMER_SLUG = process.env.STREAMER_SLUG;
const SESSION_ID = process.env.SESSION_ID;
const SESSION_TYPE = (process.env.SESSION_TYPE ?? 'normal') as SessionType;
const WORKER_PORT = Number(process.env.WORKER_PORT ?? 5001);

if (!STREAMER_SLUG) {
  console.error('[session] STREAMER_SLUG is required');
  process.exit(1);
}
if (!SESSION_ID) {
  console.error('[session] SESSION_ID is required');
  process.exit(1);
}

const HEALTH_PORT = WORKER_PORT + 1000;
const SAMPLE_RATE = 24000;

const log = (...args: unknown[]) => console.log('[session]', ...args);

// ---------------------------------------------------------------------------
// Shared mutable state
// ---------------------------------------------------------------------------

interface RuntimeState {
  streamer: StreamerRow;
  lore: StreamerLoreRow[];
  scheduledEndAt: Date;
  clients: Set<WebSocket>;
  running: boolean;
  ended: boolean;
  loopAborter: AbortController | null;
  brain: StreamerBrain;
  speaking: SpeakingPublisher;
  chatSelector: ChatSelector;
  superChatQueue: SuperChatQueue;
  chatSubscriber: ChatSubscriber | null;
}

let state: RuntimeState | null = null;

// ---------------------------------------------------------------------------
// Boot
// ---------------------------------------------------------------------------

async function loadRuntime(): Promise<RuntimeState> {
  const sb = getSupabase();

  const { data: streamer, error: streamerErr } = await sb
    .from('streamers')
    .select('*')
    .eq('slug', STREAMER_SLUG!)
    .maybeSingle();
  if (streamerErr) throw streamerErr;
  if (!streamer) throw new Error(`streamer ${STREAMER_SLUG} not found`);

  const { data: session, error: sessErr } = await sb
    .from('sessions')
    .select('*')
    .eq('id', SESSION_ID!)
    .maybeSingle();
  if (sessErr) throw sessErr;
  if (!session) throw new Error(`session ${SESSION_ID} not found`);
  if (session.streamer_id !== streamer.id) {
    throw new Error('session.streamer_id mismatch with streamer');
  }

  const { data: lore, error: loreErr } = await sb
    .from('streamer_lore')
    .select('*')
    .eq('streamer_id', streamer.id)
    .order('relevance_score', { ascending: false })
    .limit(20);
  if (loreErr) throw loreErr;

  const brain = new StreamerBrain({
    personalityConfig: streamer.personality_config,
    voiceId: streamer.voice_id,
    sampleRate: SAMPLE_RATE,
  });

  const chatSelector = new ChatSelector({
    streamerName: streamer.name,
    tokenLive: process.env.TOKEN_LIVE === 'true',
  });

  return {
    streamer: streamer as StreamerRow,
    lore: lore ?? [],
    scheduledEndAt: new Date(session.scheduled_end_at),
    clients: new Set<WebSocket>(),
    running: true,
    ended: false,
    loopAborter: null,
    brain,
    speaking: new SpeakingPublisher(streamer.slug),
    chatSelector,
    superChatQueue: new SuperChatQueue(),
    chatSubscriber: null,
  };
}

// ---------------------------------------------------------------------------
// WS broadcast
// ---------------------------------------------------------------------------

function broadcast(frame: WorkerFrame) {
  if (!state) return;
  const payload = JSON.stringify(frame);
  for (const ws of state.clients) {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(payload);
    }
  }
}

function sendTo(ws: WebSocket, frame: WorkerFrame) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(frame));
  }
}

function helloFrame(): WorkerFrame {
  if (!state) throw new Error('state unset');
  return {
    type: 'hello',
    sessionId: SESSION_ID!,
    slug: state.streamer.slug,
    streamerName: state.streamer.name,
    avatarVrmUrl: state.streamer.avatar_vrm_url,
    audioFormat: {
      sampleRate: SAMPLE_RATE,
      encoding: 'pcm_s16le',
      channels: 1,
    },
    endsAt: state.scheduledEndAt.toISOString(),
    timestamp: Date.now(),
  };
}

// ---------------------------------------------------------------------------
// Generator loop
// ---------------------------------------------------------------------------

const MIN_GAP_MS = 8_000;
const MAX_GAP_MS = 15_000;

function mapExpression(e: BrainExpression): WorkerFrame['type'] extends never
  ? never
  : 'happy' | 'angry' | 'surprised' | 'thinking' | 'laughing' {
  return e;
}

interface ResponseInstructions {
  mode: 'monologue' | 'chat_response' | 'super_chat_response';
  chatTrigger?: ChatTrigger;
  triggerMessageId?: string;
  superChatTier?: SuperChatTierT;
}

const NO_CHAT_FORCE_MS = 15_000;
const FORCE_RESPOND_PENDING = 10;
const RESPOND_TO_CHAT_PROB = 0.7;

function decideNext(): ResponseInstructions {
  if (!state) return { mode: 'monologue' };

  // 1. Super chat queue always wins.
  if (state.superChatQueue.size > 0) {
    const sc = state.superChatQueue.pickNext();
    if (sc) {
      return {
        mode: 'super_chat_response',
        triggerMessageId: sc.messageId,
        superChatTier: sc.tier,
        chatTrigger: {
          username: sc.displayName,
          content: sc.content,
          tier: sc.tier,
        },
      };
    }
  }

  // 2. Normal chat selector.
  const pendingCount = state.chatSelector.size;
  const msSinceChat = state.chatSelector.msSinceLastChat;

  if (pendingCount === 0) return { mode: 'monologue' };
  if (msSinceChat >= NO_CHAT_FORCE_MS) return { mode: 'monologue' };

  const forceRespond = pendingCount > FORCE_RESPOND_PENDING;
  const takeChat = forceRespond || Math.random() < RESPOND_TO_CHAT_PROB;
  if (!takeChat) return { mode: 'monologue' };

  const chosen = state.chatSelector.pickNext();
  if (!chosen) return { mode: 'monologue' };
  return {
    mode: 'chat_response',
    triggerMessageId: chosen.messageId,
    chatTrigger: {
      username: chosen.displayName,
      content: chosen.content,
    },
  };
}

async function runOneResponse(): Promise<void> {
  if (!state || state.ended) return;
  const responseId = randomUUID();
  let fullText = '';

  const instructions = decideNext();

  if (instructions.triggerMessageId) {
    broadcast({
      type: 'message_noticed',
      messageId: instructions.triggerMessageId,
      timestamp: Date.now(),
    });
    try {
      const sb = getSupabase();
      const now = new Date();
      const updates: {
        was_noticed: boolean;
        super_chat_addressed_at?: string;
        super_chat_pinned_until?: string;
      } = { was_noticed: true };
      if (instructions.mode === 'super_chat_response') {
        updates.super_chat_addressed_at = now.toISOString();
        if (instructions.superChatTier === SuperChatTier.TIER_3) {
          updates.super_chat_pinned_until = new Date(
            now.getTime() + SUPER_CHAT_TIER3_POST_ADDRESS_SECONDS * 1000,
          ).toISOString();
        }
      }
      await sb
        .from('chat_messages')
        .update(updates)
        .eq('id', instructions.triggerMessageId);
    } catch (err) {
      log('chat_messages was_noticed update failed:', err);
    }
  }

  broadcast({ type: 'response_start', responseId, timestamp: Date.now() });

  const aborter = new AbortController();
  state.loopAborter = aborter;

  try {
    const frames = state.brain.generate({
      mode: instructions.mode,
      lore: state.lore,
      chatTrigger: instructions.chatTrigger,
    } as Parameters<typeof state.brain.generate>[0]);
    for await (const frame of frames) {
      if (state.ended) break;
      if (aborter.signal.aborted) break;
      switch (frame.type) {
        case 'text_chunk':
          fullText += frame.text;
          break;
        case 'sentence':
          broadcast({
            type: 'text',
            content: frame.text,
            responseId,
            sentenceIndex: frame.sentenceIndex,
            timestamp: Date.now(),
          });
          break;
        case 'expression':
          broadcast({
            type: 'expression',
            expression: mapExpression(frame.expression),
            timestamp: Date.now(),
          });
          break;
        case 'audio_chunk':
          state.speaking.markActive();
          broadcast({
            type: 'audio_chunk',
            responseId,
            data: Buffer.from(frame.audio).toString('base64'),
            timestamp: Date.now(),
          });
          break;
        case 'done':
          fullText = frame.fullText;
          break;
      }
    }
  } catch (err) {
    log('brain error:', err);
  } finally {
    state.loopAborter = null;
  }

  broadcast({ type: 'response_end', responseId, timestamp: Date.now() });

  if (fullText.trim().length > 0) {
    try {
      const sb = getSupabase();
      const triggeredIds = instructions.triggerMessageId
        ? [instructions.triggerMessageId]
        : null;
      await sb.from('ai_responses').insert({
        session_id: SESSION_ID!,
        content: fullText.trim(),
        triggered_by_chat_ids: triggeredIds,
        model_used: 'claude-haiku-4-5-20251001',
      });
    } catch (err) {
      log('ai_responses insert failed:', err);
    }
  }
}

function jitterGap(): number {
  return Math.floor(MIN_GAP_MS + Math.random() * (MAX_GAP_MS - MIN_GAP_MS));
}

async function sessionLoop() {
  if (!state) return;
  while (state.running && !state.ended) {
    if (Date.now() >= state.scheduledEndAt.getTime()) {
      await endSession('timer');
      return;
    }
    await runOneResponse();
    // Back off briefly, but wake early if the session is ending.
    const wait = Math.min(
      jitterGap(),
      Math.max(0, state.scheduledEndAt.getTime() - Date.now()),
    );
    await new Promise<void>((r) => setTimeout(r, wait));
  }
}

// ---------------------------------------------------------------------------
// Session info heartbeat
// ---------------------------------------------------------------------------

function startSessionInfoHeartbeat(): NodeJS.Timeout {
  return setInterval(() => {
    if (!state || state.ended) return;
    const msLeft = state.scheduledEndAt.getTime() - Date.now();
    broadcast({
      type: 'session_info',
      endsAt: state.scheduledEndAt.toISOString(),
      secondsRemaining: Math.max(0, Math.floor(msLeft / 1000)),
      timestamp: Date.now(),
    });
  }, 10_000);
}

// ---------------------------------------------------------------------------
// End / crash handlers
// ---------------------------------------------------------------------------

async function endSession(reason: SessionEndReason): Promise<void> {
  if (!state || state.ended) return;
  state.ended = true;
  state.running = false;
  state.loopAborter?.abort();

  broadcast({ type: 'session_ending', reason, timestamp: Date.now() });

  const endedAt = new Date();
  const sb = getSupabase();

  try {
    await sb
      .from('sessions')
      .update({
        ended_at: endedAt.toISOString(),
        end_reason: reason,
      })
      .eq('id', SESSION_ID!);
  } catch (err) {
    log('sessions update failed:', err);
  }

  try {
    const current = state.streamer;
    if (SESSION_TYPE === 'revival') {
      const now = new Date();
      const resetAt = current.revival_count_reset_at
        ? new Date(current.revival_count_reset_at)
        : null;
      const needsReset =
        !resetAt || now.getTime() - resetAt.getTime() > 24 * 60 * 60 * 1000;
      await sb
        .from('streamers')
        .update({
          status: 'COOLING_DOWN',
          current_session_id: null,
          last_session_ended_at: endedAt.toISOString(),
          total_sessions: current.total_sessions + 1,
          revival_count_today: needsReset
            ? 1
            : current.revival_count_today + 1,
          revival_count_reset_at: needsReset
            ? now.toISOString()
            : current.revival_count_reset_at,
          // NOTE: ready_at unchanged on revival (freebie)
        })
        .eq('id', current.id);
    } else {
      const readyAt = new Date(endedAt.getTime() + COOLDOWN_MS);
      await sb
        .from('streamers')
        .update({
          status: 'COOLING_DOWN',
          current_session_id: null,
          last_session_ended_at: endedAt.toISOString(),
          ready_at: readyAt.toISOString(),
          total_sessions: current.total_sessions + 1,
        })
        .eq('id', current.id);
    }
  } catch (err) {
    log('streamers update failed:', err);
  }

  for (const ws of state.clients) {
    try {
      ws.close();
    } catch {
      /* noop */
    }
  }
  state.clients.clear();

  await state.speaking.stop();
  state.chatSelector.stop();
  if (state.chatSubscriber) await state.chatSubscriber.stop();

  log('session ended; exit 0');
  // let logs flush
  setTimeout(() => process.exit(0), 100);
}

function installCrashHandler() {
  const handler = async (err: unknown) => {
    console.error('[session] uncaught:', err);
    const killAt = setTimeout(() => {
      console.error('[session] crash flush timed out; force exit');
      process.exit(1);
    }, 2000);

    try {
      await endSession('crash');
    } catch (e) {
      console.error('[session] crash end failed:', e);
    } finally {
      clearTimeout(killAt);
      process.exit(1);
    }
  };
  process.on('uncaughtException', handler);
  process.on('unhandledRejection', handler);
}

// ---------------------------------------------------------------------------
// Health server
// ---------------------------------------------------------------------------

async function startHealth() {
  const app = Fastify({ logger: false });
  app.get('/health', async () => {
    const msLeft = state
      ? state.scheduledEndAt.getTime() - Date.now()
      : 0;
    return {
      service: 'worker-session',
      slug: STREAMER_SLUG,
      sessionId: SESSION_ID,
      connectedClients: state?.clients.size ?? 0,
      secondsUntilEnd: Math.max(0, Math.floor(msLeft / 1000)),
      ended: state?.ended ?? false,
    };
  });
  await app.listen({ port: HEALTH_PORT, host: '0.0.0.0' });
  log(`health listening on :${HEALTH_PORT}`);
}

// ---------------------------------------------------------------------------
// WS server
// ---------------------------------------------------------------------------

function startWs() {
  const server = createServer();
  const wss = new WebSocketServer({ server });
  wss.on('connection', (ws) => {
    if (!state) {
      ws.close();
      return;
    }
    state.clients.add(ws);
    sendTo(ws, helloFrame());
    log(`client connected (${state.clients.size})`);
    ws.on('close', () => {
      state?.clients.delete(ws);
      log(`client closed (${state?.clients.size ?? 0})`);
    });
    ws.on('error', (err) => log('ws error:', err));
  });
  server.listen(WORKER_PORT, '0.0.0.0');
  log(`ws listening on :${WORKER_PORT}`);
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  installCrashHandler();
  state = await loadRuntime();
  log(`loaded streamer=${state.streamer.slug} endsAt=${state.scheduledEndAt.toISOString()}`);

  state.speaking.start();
  state.chatSelector.start();

  // Redis chat subscription (no-op if REDIS_URL absent)
  state.chatSubscriber = new ChatSubscriber(
    state.streamer.slug,
    (envelope) => {
      if (!state || state.ended) return;
      if (envelope.isSuperChat) {
        const tier = (envelope.superChatTier ?? 1) as SuperChatTierT;
        state.superChatQueue.push({
          messageId: envelope.messageId,
          userId: envelope.userId,
          displayName: envelope.displayName,
          content: envelope.content,
          tier,
          createdAt: envelope.createdAt,
        });
        return;
      }
      state.chatSelector.add({
        messageId: envelope.messageId,
        userId: envelope.userId,
        displayName: envelope.displayName,
        content: envelope.content,
        tokenBalance: envelope.senderTokenBalance,
        createdAt: envelope.createdAt,
      });
    },
  );
  state.chatSubscriber.start();

  await startHealth();
  startWs();
  startSessionInfoHeartbeat();

  // Kick the loop. If scheduled_end_at is already in the past, end.
  if (Date.now() >= state.scheduledEndAt.getTime()) {
    await endSession('timer');
    return;
  }

  sessionLoop().catch((err) => {
    console.error('[session] loop crashed:', err);
    endSession('crash').finally(() => process.exit(1));
  });
}

main().catch((err) => {
  console.error('[session] boot failed:', err);
  process.exit(1);
});
