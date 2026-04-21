import { getSupabase } from '../supabase.js';

const STORAGE_BUCKET = 'transcripts';

type TranscriptEvent =
  | {
      kind: 'chat';
      at: string;
      displayName: string;
      content: string;
      isSuperChat: boolean;
      tier?: number | null;
    }
  | { kind: 'ai'; at: string; content: string };

/**
 * Build the session transcript from chat_messages + ai_responses,
 * interleaved by created_at. Returns plain text plus a count so the
 * caller can skip the upload if the session had nothing to say.
 */
export async function buildTranscript(
  sessionId: string,
): Promise<{ text: string; events: number }> {
  const sb = getSupabase();
  const [msgRes, aiRes] = await Promise.all([
    sb
      .from('chat_messages')
      .select(
        'id, content, created_at, is_super_chat, super_chat_tier, user_id',
      )
      .eq('session_id', sessionId)
      .order('created_at', { ascending: true }),
    sb
      .from('ai_responses')
      .select('id, content, created_at')
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
  let userLookup = new Map<
    string,
    { display_name: string | null; wallet_address: string | null }
  >();
  if (userIds.length > 0) {
    const { data: users } = await sb
      .from('users')
      .select('id, display_name, wallet_address')
      .in('id', userIds);
    userLookup = new Map(
      (users ?? []).map((u) => [
        u.id,
        { display_name: u.display_name, wallet_address: u.wallet_address },
      ]),
    );
  }

  const events: TranscriptEvent[] = [];
  for (const m of msgRes.data ?? []) {
    const u = m.user_id ? userLookup.get(m.user_id) : null;
    const displayName = u?.wallet_address
      ? `${u.wallet_address.slice(0, 6)}…${u.wallet_address.slice(-4)}`
      : (u?.display_name ?? 'guest');
    events.push({
      kind: 'chat',
      at: m.created_at,
      displayName,
      content: m.content,
      isSuperChat: m.is_super_chat,
      tier: m.super_chat_tier,
    });
  }
  for (const r of aiRes.data ?? []) {
    events.push({ kind: 'ai', at: r.created_at, content: r.content });
  }
  events.sort((a, b) => a.at.localeCompare(b.at));

  const lines = events.map((e) => {
    const t = new Date(e.at).toISOString();
    if (e.kind === 'ai') return `[${t}] STREAMER: ${e.content}`;
    const tag = e.isSuperChat ? ` *SUPER T${e.tier ?? '?'}*` : '';
    return `[${t}] ${e.displayName}${tag}: ${e.content}`;
  });
  return { text: lines.join('\n'), events: events.length };
}

/**
 * Upload a transcript to Supabase Storage and mark sessions.transcript_url.
 * Best-effort: logs + returns null on failure, never throws (the
 * session-end path still needs to finish cleanly).
 */
export async function assembleAndUploadTranscript(
  sessionId: string,
  streamerSlug: string,
): Promise<string | null> {
  try {
    const { text, events } = await buildTranscript(sessionId);
    if (events === 0) return null;
    const sb = getSupabase();
    const path = `${streamerSlug}/${sessionId}.txt`;
    const body = new TextEncoder().encode(text);

    let publicUrl: string | null = null;
    try {
      const { error } = await sb.storage.from(STORAGE_BUCKET).upload(path, body, {
        contentType: 'text/plain; charset=utf-8',
        upsert: true,
      });
      if (!error) {
        publicUrl = sb.storage.from(STORAGE_BUCKET).getPublicUrl(path).data
          .publicUrl;
      } else {
        console.warn('[transcript] storage upload failed:', error.message);
      }
    } catch (err) {
      console.warn('[transcript] storage threw:', err);
    }

    // If Storage unavailable, at least stamp a placeholder marker so
    // the sessions row reflects that a transcript was generated.
    const finalUrl = publicUrl ?? `inline://${path}`;
    await sb
      .from('sessions')
      .update({ transcript_url: finalUrl })
      .eq('id', sessionId);
    return finalUrl;
  } catch (err) {
    console.warn('[transcript] assemble failed:', err);
    return null;
  }
}
