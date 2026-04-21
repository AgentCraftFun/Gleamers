'use client';

import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from 'react';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { getSupabaseBrowser } from '@/lib/supabase';
import { truncateWallet } from '@/lib/format';
import { useMe } from '@/lib/auth/useMe';
import { SuperChatButton } from './SuperChatButton';
import {
  SUPER_CHAT_TIER_COPY,
  type SuperChatTier,
} from '@gleamers/shared';

interface Props {
  slug: string;
  sessionId: string | null;
  isLive: boolean;
  /** Message IDs the worker has flagged as noticed (live push). */
  noticedMessageIds: Set<string>;
}

interface Row {
  id: string;
  session_id: string;
  user_id: string | null;
  content: string;
  was_noticed: boolean;
  is_super_chat: boolean;
  super_chat_tier: number | null;
  super_chat_amount: string | null;
  super_chat_pinned_until: string | null;
  created_at: string;
}

interface DisplayMessage extends Row {
  display_name: string;
  wallet_address: string | null;
  noticed: boolean;
}

const SUPER_CHAT_TIER_CARD: Record<SuperChatTier, string> = {
  1: 'border-amber-500/60 bg-amber-500/10 ring-1 ring-amber-500/40',
  2: 'border-purple-500/60 bg-purple-500/10 ring-1 ring-purple-500/40',
  3: 'border-fuchsia-500/60 bg-gradient-to-br from-fuchsia-500/20 via-purple-500/20 to-amber-500/20 ring-2 ring-fuchsia-400/50 [box-shadow:0_0_24px_-4px_rgb(232_121_249/0.7)]',
};

const SUPER_CHAT_TIER_ENTRY: Record<SuperChatTier, string> = {
  1: 'animate-in slide-in-from-top fade-in duration-300',
  2: 'animate-in slide-in-from-top fade-in duration-500',
  3: 'animate-in zoom-in fade-in duration-700',
};

const PAGE_SIZE = 60;

function formatSenderName(
  row: { display_name: string | null; wallet_address: string | null } | null,
): string {
  if (!row) return 'guest';
  if (row.wallet_address) return truncateWallet(row.wallet_address);
  return row.display_name ?? 'guest';
}

function formatClock(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleTimeString(undefined, {
      hour: '2-digit',
      minute: '2-digit',
    });
  } catch {
    return '';
  }
}

export function ChatPanel({ slug, sessionId, isLive, noticedMessageIds }: Props) {
  const { me, refresh: refreshMe } = useMe();
  const [messages, setMessages] = useState<DisplayMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [autoScroll, setAutoScroll] = useState(true);
  const scrollRef = useRef<HTMLDivElement>(null);

  // Load initial page + subscribe to realtime for this session.
  useEffect(() => {
    if (!sessionId) {
      setMessages([]);
      return;
    }
    let cancelled = false;
    const sb = getSupabaseBrowser();

    async function loadInitial() {
      const { data: rows, error } = await sb
        .from('chat_messages')
        .select(
          'id, session_id, user_id, content, was_noticed, is_super_chat, super_chat_tier, super_chat_amount, super_chat_pinned_until, created_at',
        )
        .eq('session_id', sessionId!)
        .order('created_at', { ascending: true })
        .limit(PAGE_SIZE);
      if (cancelled || error || !rows) return;

      const userIds = [
        ...new Set(rows.map((r) => r.user_id).filter(Boolean) as string[]),
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
            {
              display_name: u.display_name,
              wallet_address: u.wallet_address,
            },
          ]),
        );
      }

      const next: DisplayMessage[] = rows.map((r) => {
        const u = r.user_id ? userLookup.get(r.user_id) : null;
        return {
          ...r,
          display_name: formatSenderName(u ?? null),
          wallet_address: u?.wallet_address ?? null,
          noticed: r.was_noticed,
        };
      });
      setMessages(next);
    }
    loadInitial();

    const channel = sb
      .channel(`chat:${sessionId}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        async (payload) => {
          const row = payload.new as Row;
          let display_name = 'guest';
          let wallet_address: string | null = null;
          if (row.user_id) {
            const { data: u } = await sb
              .from('users')
              .select('display_name, wallet_address')
              .eq('id', row.user_id)
              .maybeSingle();
            display_name = formatSenderName(u ?? null);
            wallet_address = u?.wallet_address ?? null;
          }
          setMessages((prev) => {
            if (prev.some((m) => m.id === row.id)) return prev;
            return [
              ...prev,
              {
                ...row,
                display_name,
                wallet_address,
                noticed: row.was_noticed,
              },
            ];
          });
        },
      )
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'chat_messages',
          filter: `session_id=eq.${sessionId}`,
        },
        (payload) => {
          const row = payload.new as Row;
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id
                ? { ...m, was_noticed: row.was_noticed, noticed: row.was_noticed }
                : m,
            ),
          );
        },
      )
      .subscribe();

    return () => {
      cancelled = true;
      void sb.removeChannel(channel);
    };
  }, [sessionId]);

  // Apply live noticed IDs from the worker WS (faster than Supabase realtime).
  useEffect(() => {
    if (noticedMessageIds.size === 0) return;
    setMessages((prev) =>
      prev.map((m) =>
        noticedMessageIds.has(m.id) ? { ...m, noticed: true } : m,
      ),
    );
  }, [noticedMessageIds]);

  // Auto-scroll on new messages unless the user scrolled up.
  useLayoutEffect(() => {
    if (!autoScroll) return;
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
  }, [messages, autoScroll]);

  const onScroll = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    const atBottom =
      el.scrollHeight - el.scrollTop - el.clientHeight < 40;
    setAutoScroll(atBottom);
  }, []);

  const scrollToLatest = useCallback(() => {
    const el = scrollRef.current;
    if (!el) return;
    el.scrollTop = el.scrollHeight;
    setAutoScroll(true);
  }, []);

  const placeholder = useMemo(() => {
    if (!isLive) return 'Chat opens when the streamer goes live.';
    if (!me) return 'Connecting…';
    return me.is_anonymous
      ? `Chat as ${me.display_name ?? 'guest'}`
      : `Chat as ${truncateWallet(me.wallet_address ?? '')}`;
  }, [isLive, me]);

  const { pinnedSuper, restFeed } = useMemo(() => {
    const now = Date.now();
    const pins: DisplayMessage[] = [];
    const rest: DisplayMessage[] = [];
    for (const m of messages) {
      const pinnedActive =
        m.is_super_chat &&
        m.super_chat_pinned_until &&
        new Date(m.super_chat_pinned_until).getTime() > now;
      if (pinnedActive) pins.push(m);
      else rest.push(m);
    }
    // Highest tier first, then most recent.
    pins.sort((a, b) => {
      const tierDiff = (b.super_chat_tier ?? 0) - (a.super_chat_tier ?? 0);
      if (tierDiff !== 0) return tierDiff;
      return (
        new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
      );
    });
    return { pinnedSuper: pins, restFeed: rest };
  }, [messages]);

  async function send() {
    if (!isLive || !input.trim() || sending) return;
    setSending(true);
    setError(null);
    try {
      const res = await fetch('/api/chat/send', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'same-origin',
        body: JSON.stringify({ slug, content: input.trim() }),
      });
      if (!res.ok) {
        let body: { error?: string; retryAfterMs?: number } = {};
        try {
          body = await res.json();
        } catch {
          /* noop */
        }
        if (body.error === 'rate_limited') {
          const secs = Math.ceil((body.retryAfterMs ?? 0) / 1000);
          setError(`Slow down — try again in ${secs}s.`);
        } else if (body.error === 'moderation_blocked') {
          setError('That message was blocked by moderation.');
        } else if (body.error === 'session_not_live') {
          setError('Session ended.');
        } else {
          setError(body.error ?? `Failed (${res.status})`);
        }
        return;
      }
      setInput('');
      // Ensure /api/me reflects any lazy user creation.
      await refreshMe();
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  }

  function onKey(e: KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send();
    }
  }

  return (
    <aside className="flex min-h-[420px] flex-col rounded-xl border border-border bg-card">
      <div className="flex items-center justify-between border-b border-border p-3">
        <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
          Chat
        </h2>
        <span className="text-[11px] text-muted-foreground">
          {messages.length} messages
        </span>
      </div>

      {pinnedSuper.length > 0 ? (
        <div className="space-y-2 border-b border-border bg-background/40 p-3">
          {pinnedSuper.map((m) => (
            <SuperChatCard key={m.id} message={m} />
          ))}
        </div>
      ) : null}

      <div
        ref={scrollRef}
        onScroll={onScroll}
        className="relative flex-1 overflow-y-auto px-3 py-2 text-sm"
      >
        {messages.length === 0 ? (
          <p className="py-6 text-center text-muted-foreground">
            Be the first to chat.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {restFeed.map((m) =>
              m.is_super_chat ? (
                <li key={m.id}>
                  <SuperChatCard message={m} variant="feed" />
                </li>
              ) : (
                <li
                  key={m.id}
                  className={cn(
                    'rounded-md px-2 py-1.5 leading-snug transition-colors',
                    m.noticed &&
                      'bg-primary/15 ring-1 ring-primary/40 [box-shadow:0_0_12px_-2px_hsl(var(--primary)/0.6)]',
                  )}
                >
                  <div className="flex items-center gap-2 text-[11px] text-muted-foreground">
                    <span
                      className={cn(
                        'font-medium',
                        m.wallet_address
                          ? 'text-primary'
                          : 'text-muted-foreground',
                      )}
                    >
                      {m.display_name}
                    </span>
                    <span>{formatClock(m.created_at)}</span>
                    {m.noticed ? (
                      <span className="rounded-full bg-primary/20 px-1.5 text-[9px] font-semibold uppercase tracking-widest text-primary">
                        Seen
                      </span>
                    ) : null}
                  </div>
                  <div className="break-words">{m.content}</div>
                </li>
              ),
            )}
          </ul>
        )}

        {!autoScroll ? (
          <Button
            onClick={scrollToLatest}
            size="sm"
            className="pointer-events-auto absolute bottom-3 right-3"
          >
            Scroll to latest ↓
          </Button>
        ) : null}
      </div>

      <div className="border-t border-border p-3">
        <div className="flex items-end gap-2">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={onKey}
            rows={2}
            disabled={!isLive || sending}
            placeholder={placeholder}
            className="min-h-[42px] flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
          />
          <div className="flex flex-col gap-2">
            <Button
              type="button"
              onClick={() => void send()}
              disabled={!isLive || !input.trim() || sending}
            >
              {sending ? 'Sending…' : 'Send'}
            </Button>
            <SuperChatButton slug={slug} disabled={!isLive} />
          </div>
        </div>
        {error ? (
          <p className="mt-2 text-xs text-destructive-foreground">{error}</p>
        ) : null}
      </div>
    </aside>
  );
}

interface SuperChatCardProps {
  message: DisplayMessage;
  variant?: 'pinned' | 'feed';
}

function SuperChatCard({ message, variant = 'pinned' }: SuperChatCardProps) {
  const tier = (message.super_chat_tier ?? 1) as SuperChatTier;
  const tierCopy = SUPER_CHAT_TIER_COPY[tier];
  return (
    <div
      className={cn(
        'rounded-lg border px-3 py-2 text-sm',
        SUPER_CHAT_TIER_CARD[tier],
        variant === 'pinned' ? SUPER_CHAT_TIER_ENTRY[tier] : '',
      )}
    >
      <div className="flex items-center gap-2 text-[10px] font-semibold uppercase tracking-widest">
        <span>Super Chat</span>
        <span className="rounded-sm bg-black/30 px-1.5 py-0.5 text-white">
          {tierCopy.name}
        </span>
        <span className="text-muted-foreground">{tierCopy.pinBlurb}</span>
      </div>
      <div className="mt-1 flex items-baseline justify-between gap-2 text-[11px] text-muted-foreground">
        <span
          className={cn(
            'font-medium',
            message.wallet_address
              ? 'text-primary'
              : 'text-muted-foreground',
          )}
        >
          {message.display_name}
        </span>
        <span>{formatClock(message.created_at)}</span>
      </div>
      <div className="mt-1 break-words text-sm leading-snug text-foreground">
        {message.content}
      </div>
    </div>
  );
}
