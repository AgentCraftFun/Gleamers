import Anthropic from '@anthropic-ai/sdk';
import type { LoreType } from '@gleamers/shared';
import { getSupabase } from './supabase.js';

/**
 * Post-session processing: pulls the transcript, runs Haiku for a
 * short summary and Sonnet 4.6 for a structured lore extraction,
 * then inserts streamer_lore rows at the scores the spec demands.
 *
 * Fails open on any step. No BullMQ for MVP — this runs inline inside
 * the POST /sessions/:id/post-process handler's background promise.
 */

const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';
const LORE_MODEL = 'claude-sonnet-4-6';

const LORE_SYSTEM = `You extract lore from a VTuber-style AI stream transcript.
Return ONLY valid JSON matching this shape:
{
  "catchphrases": string[],
  "relationships": [{ "chatter_username": string, "description": string }],
  "jokes": string[],
  "opinions": string[]
}
Err on fewer, higher-quality items. Skip anything that isn't clearly on-brand. Max 4 items per array.`;

const SUMMARY_SYSTEM =
  'Summarise this VTuber stream transcript in 2-3 sentences. Keep the streamer\'s voice; no meta commentary.';

interface LoreExtraction {
  catchphrases: string[];
  relationships: { chatter_username: string; description: string }[];
  jokes: string[];
  opinions: string[];
}

const LORE_SCORES: Record<LoreType, number> = {
  catchphrase: 1.0,
  chatter_relationship: 1.2,
  inside_joke: 1.0,
  opinion: 0.8,
  // These types are produced/tagged elsewhere; listed for completeness.
  arc: 1.0,
  super_chat_supporter: 1.5,
};

function anthropic(): Anthropic | null {
  const key = process.env.ANTHROPIC_API_KEY;
  if (!key) {
    console.warn('[post-process] ANTHROPIC_API_KEY unset — skipping');
    return null;
  }
  return new Anthropic({ apiKey: key });
}

async function fetchTranscript(
  sessionId: string,
): Promise<{ text: string; streamerId: string } | null> {
  const sb = getSupabase();
  const { data: session } = await sb
    .from('sessions')
    .select('streamer_id, transcript_url')
    .eq('id', sessionId)
    .maybeSingle();
  if (!session) return null;

  // Prefer storage, fall back to rebuilding from chat_messages +
  // ai_responses if the transcript was never uploaded.
  if (session.transcript_url && !session.transcript_url.startsWith('inline://')) {
    try {
      const res = await fetch(session.transcript_url);
      if (res.ok) {
        const text = await res.text();
        return { text, streamerId: session.streamer_id };
      }
    } catch (err) {
      console.warn('[post-process] transcript fetch failed; rebuilding', err);
    }
  }

  const [msgRes, aiRes] = await Promise.all([
    sb
      .from('chat_messages')
      .select('content, created_at, is_super_chat, super_chat_tier, user_id')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    sb
      .from('ai_responses')
      .select('content, created_at')
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
  ]);

  const userIds = [
    ...new Set(
      (msgRes.data ?? [])
        .map((m) => m.user_id)
        .filter((id): id is string => Boolean(id)),
    ),
  ];
  const lookup = new Map<string, string>();
  if (userIds.length > 0) {
    const { data: users } = await sb
      .from('users')
      .select('id, display_name, wallet_address')
      .in('id', userIds);
    for (const u of users ?? []) {
      lookup.set(
        u.id,
        u.wallet_address
          ? `${u.wallet_address.slice(0, 6)}…${u.wallet_address.slice(-4)}`
          : (u.display_name ?? 'guest'),
      );
    }
  }

  const events: { at: string; line: string }[] = [];
  for (const m of msgRes.data ?? []) {
    const who = m.user_id ? (lookup.get(m.user_id) ?? 'guest') : 'guest';
    const tag = m.is_super_chat ? ` *SUPER T${m.super_chat_tier ?? '?'}*` : '';
    events.push({ at: m.created_at, line: `${who}${tag}: ${m.content}` });
  }
  for (const r of aiRes.data ?? []) {
    events.push({ at: r.created_at, line: `STREAMER: ${r.content}` });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));
  return {
    text: events.map((e) => e.line).join('\n'),
    streamerId: session.streamer_id,
  };
}

async function summarize(client: Anthropic, transcript: string): Promise<string | null> {
  try {
    const res = await client.messages.create({
      model: SUMMARY_MODEL,
      max_tokens: 220,
      system: SUMMARY_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });
    return res.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join(' ')
      .trim() || null;
  } catch (err) {
    console.warn('[post-process] summary failed:', err);
    return null;
  }
}

function parseLoreJson(raw: string): LoreExtraction | null {
  // Sonnet sometimes wraps JSON in ```json fences. Strip them.
  let text = raw.trim();
  const fenceMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch && fenceMatch[1]) text = fenceMatch[1].trim();
  try {
    const parsed = JSON.parse(text) as Partial<LoreExtraction>;
    return {
      catchphrases: Array.isArray(parsed.catchphrases)
        ? parsed.catchphrases.filter((s): s is string => typeof s === 'string')
        : [],
      relationships: Array.isArray(parsed.relationships)
        ? parsed.relationships.filter(
            (r): r is { chatter_username: string; description: string } =>
              !!r &&
              typeof (r as { chatter_username: unknown }).chatter_username ===
                'string' &&
              typeof (r as { description: unknown }).description === 'string',
          )
        : [],
      jokes: Array.isArray(parsed.jokes)
        ? parsed.jokes.filter((s): s is string => typeof s === 'string')
        : [],
      opinions: Array.isArray(parsed.opinions)
        ? parsed.opinions.filter((s): s is string => typeof s === 'string')
        : [],
    };
  } catch (err) {
    console.warn('[post-process] lore JSON parse failed:', err);
    return null;
  }
}

async function extractLore(
  client: Anthropic,
  transcript: string,
): Promise<LoreExtraction | null> {
  try {
    const res = await client.messages.create({
      model: LORE_MODEL,
      max_tokens: 900,
      system: LORE_SYSTEM,
      messages: [{ role: 'user', content: transcript }],
    });
    const text = res.content
      .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
      .map((b) => b.text)
      .join('\n');
    return parseLoreJson(text);
  } catch (err) {
    console.warn('[post-process] lore extraction failed:', err);
    return null;
  }
}

export interface PostProcessResult {
  summaryUpdated: boolean;
  loreInserted: number;
  skipped?: string;
}

export async function runPostProcess(
  sessionId: string,
): Promise<PostProcessResult> {
  const sb = getSupabase();
  const loaded = await fetchTranscript(sessionId);
  if (!loaded || loaded.text.trim().length === 0) {
    return { summaryUpdated: false, loreInserted: 0, skipped: 'empty_transcript' };
  }
  const client = anthropic();
  if (!client) {
    return { summaryUpdated: false, loreInserted: 0, skipped: 'no_api_key' };
  }

  // 1. Short summary → sessions.summary
  const summary = await summarize(client, loaded.text);
  let summaryUpdated = false;
  if (summary) {
    const { error } = await sb
      .from('sessions')
      .update({ summary })
      .eq('id', sessionId);
    summaryUpdated = !error;
  }

  // 2. Lore extraction (Sonnet)
  const lore = await extractLore(client, loaded.text);
  let inserted = 0;
  if (lore) {
    const rows: Array<{
      streamer_id: string;
      lore_type: LoreType;
      content: string;
      metadata: Record<string, unknown>;
      relevance_score: number;
    }> = [];
    for (const c of lore.catchphrases.slice(0, 4)) {
      rows.push({
        streamer_id: loaded.streamerId,
        lore_type: 'catchphrase',
        content: c,
        metadata: { sessionId },
        relevance_score: LORE_SCORES.catchphrase,
      });
    }
    for (const r of lore.relationships.slice(0, 4)) {
      rows.push({
        streamer_id: loaded.streamerId,
        lore_type: 'chatter_relationship',
        content: `${r.chatter_username}: ${r.description}`,
        metadata: { sessionId, chatter_username: r.chatter_username },
        relevance_score: LORE_SCORES.chatter_relationship,
      });
    }
    for (const j of lore.jokes.slice(0, 4)) {
      rows.push({
        streamer_id: loaded.streamerId,
        lore_type: 'inside_joke',
        content: j,
        metadata: { sessionId },
        relevance_score: LORE_SCORES.inside_joke,
      });
    }
    for (const o of lore.opinions.slice(0, 4)) {
      rows.push({
        streamer_id: loaded.streamerId,
        lore_type: 'opinion',
        content: o,
        metadata: { sessionId },
        relevance_score: LORE_SCORES.opinion,
      });
    }
    if (rows.length > 0) {
      const { error } = await sb.from('streamer_lore').insert(rows);
      if (error) {
        console.warn('[post-process] lore insert failed:', error.message);
      } else {
        inserted = rows.length;
      }
    }
  }

  console.log(
    `[post-process] session=${sessionId} summary=${summaryUpdated} lore=${inserted}`,
  );
  return { summaryUpdated, loreInserted: inserted };
}
