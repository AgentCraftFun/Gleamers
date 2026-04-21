import { NextResponse } from 'next/server';
import {
  CHAT_CHANNEL_PREFIX,
  type ChatPublishEnvelope,
} from '@gleamers/shared';

import { createSupabaseAdmin } from '@/lib/supabase';
import { resolveActor } from '@/lib/chat/users';
import { moderate } from '@/lib/chat/moderation';
import { checkBlocklist } from '@/lib/chat/blocklist';
import { CHAT_RULES, checkRateLimit } from '@/lib/rate-limit';
import { getRedis } from '@/lib/redis';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const MAX_CONTENT_LEN = 500;

interface Body {
  slug?: string;
  content?: string;
}

function clientIp(req: Request): string {
  const xff = req.headers.get('x-forwarded-for');
  if (xff) return xff.split(',')[0]!.trim();
  return req.headers.get('x-real-ip') ?? 'unknown';
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const slug = body.slug?.trim();
  const content = body.content?.trim();
  if (!slug || !content) {
    return NextResponse.json(
      { error: 'missing_fields' },
      { status: 400 },
    );
  }
  if (content.length > MAX_CONTENT_LEN) {
    return NextResponse.json(
      { error: 'too_long', maxLength: MAX_CONTENT_LEN },
      { status: 400 },
    );
  }

  // Resolve actor (authed or lazy-create anon)
  let actor;
  try {
    actor = await resolveActor();
  } catch (err) {
    return NextResponse.json(
      { error: 'actor_resolve_failed', detail: String(err) },
      { status: 500 },
    );
  }

  // Rate limits — per-user burst + sustained, per-IP distributed spam.
  const ip = clientIp(req);
  const keys = [
    { key: `rl:chat:u:${actor.userId}:burst`, rule: CHAT_RULES.burst },
    {
      key: `rl:chat:u:${actor.userId}:sustained`,
      rule: CHAT_RULES.sustained,
    },
    { key: `rl:chat:ip:${ip}`, rule: CHAT_RULES.ip },
  ];
  for (const { key, rule } of keys) {
    const check = await checkRateLimit(key, rule);
    if (!check.allowed) {
      return NextResponse.json(
        {
          error: 'rate_limited',
          scope: key.includes(':ip:') ? 'ip' : 'user',
          retryAfterMs: check.retryAfterMs,
        },
        { status: 429 },
      );
    }
  }

  // Session lookup (must be LIVE)
  const sb = createSupabaseAdmin();
  const { data: streamer, error: strErr } = await sb
    .from('streamers')
    .select('id, status, current_session_id')
    .eq('slug', slug)
    .maybeSingle();
  if (strErr) {
    return NextResponse.json(
      { error: 'db_error', detail: strErr.message },
      { status: 500 },
    );
  }
  if (!streamer) {
    return NextResponse.json({ error: 'streamer_not_found' }, { status: 404 });
  }
  if (streamer.status !== 'LIVE' || !streamer.current_session_id) {
    return NextResponse.json(
      { error: 'session_not_live' },
      { status: 409 },
    );
  }

  // Blocklist (cheap, hot-reloadable) runs before OpenAI moderation
  // so obvious matches don't pay a network round-trip.
  const block = await checkBlocklist(content);
  if (block.blocked) {
    await sb.from('moderation_events').insert({
      event_type: 'input_blocked',
      session_id: streamer.current_session_id,
      user_id: actor.userId,
      content_snippet: content.slice(0, 200),
      reason: block.reason,
    });
    return NextResponse.json(
      { error: 'moderation_blocked' },
      { status: 400 },
    );
  }

  // OpenAI moderation
  const mod = await moderate(content);
  if (mod.flagged) {
    await sb.from('moderation_events').insert({
      event_type: 'input_blocked',
      session_id: streamer.current_session_id,
      user_id: actor.userId,
      content_snippet: content.slice(0, 200),
      reason: (mod.categories ?? ['flagged']).join(','),
    });
    return NextResponse.json(
      { error: 'moderation_blocked' },
      { status: 400 },
    );
  }

  // Insert chat_messages
  const nowIso = new Date().toISOString();
  const { data: inserted, error: insErr } = await sb
    .from('chat_messages')
    .insert({
      session_id: streamer.current_session_id,
      user_id: actor.userId,
      content,
      sender_token_balance: actor.tokenBalance,
      is_super_chat: false,
    })
    .select('id, created_at')
    .single();
  if (insErr || !inserted) {
    return NextResponse.json(
      { error: 'insert_failed', detail: insErr?.message ?? 'unknown' },
      { status: 500 },
    );
  }

  // Publish to Redis (best-effort)
  const redis = getRedis();
  if (redis) {
    const envelope: ChatPublishEnvelope = {
      messageId: inserted.id,
      sessionId: streamer.current_session_id,
      slug,
      userId: actor.userId,
      displayName: actor.displayName,
      content,
      senderTokenBalance: actor.tokenBalance,
      isSuperChat: false,
      createdAt: inserted.created_at ?? nowIso,
    };
    try {
      await redis.publish(
        `${CHAT_CHANNEL_PREFIX}${slug}`,
        JSON.stringify(envelope),
      );
    } catch (err) {
      console.warn('[chat] redis publish failed:', err);
    }
  }

  return NextResponse.json({
    ok: true,
    messageId: inserted.id,
    displayName: actor.displayName,
  });
}
