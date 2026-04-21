import { createSupabaseAdmin } from '@/lib/supabase';
import {
  readAnonymousCookie,
  readOrCreateAnonymous,
  readSession,
} from '@/lib/auth/session';

export interface ChatActor {
  userId: string;
  displayName: string;
  walletAddress: string | null;
  isAnonymous: boolean;
  tokenBalance: string;
}

function guestName(anonymousId: string): string {
  const compact = anonymousId.replace(/-/g, '');
  return `guest_${compact.slice(0, 4).toUpperCase()}`;
}

/**
 * Resolve the current chat actor. If a wallet session exists, returns
 * the users row. Otherwise, uses the gleamers_anon cookie (minting
 * one if missing) and lazily inserts a users row keyed by
 * anonymous_id — the lazy-create path promised by the spec.
 */
export async function resolveActor(): Promise<ChatActor> {
  const session = await readSession();
  const sb = createSupabaseAdmin();

  if (session) {
    const { data: user } = await sb
      .from('users')
      .select('id, display_name, wallet_address, token_balance_cached')
      .eq('id', session.userId)
      .maybeSingle();
    if (user) {
      return {
        userId: user.id,
        displayName:
          user.display_name ?? session.walletAddress.slice(0, 10),
        walletAddress: user.wallet_address,
        isAnonymous: false,
        tokenBalance: user.token_balance_cached ?? '0',
      };
    }
    // Stale session — fall through to anon path.
  }

  const anonCookie = readAnonymousCookie();
  const anon = anonCookie
    ? { anonymousId: anonCookie, displayName: guestName(anonCookie) }
    : readOrCreateAnonymous();

  const { data: existing } = await sb
    .from('users')
    .select('id, display_name, token_balance_cached')
    .eq('anonymous_id', anon.anonymousId)
    .maybeSingle();
  if (existing) {
    return {
      userId: existing.id,
      displayName: existing.display_name ?? anon.displayName,
      walletAddress: null,
      isAnonymous: true,
      tokenBalance: existing.token_balance_cached ?? '0',
    };
  }

  const { data: inserted, error } = await sb
    .from('users')
    .insert({
      anonymous_id: anon.anonymousId,
      display_name: anon.displayName,
    })
    .select('id')
    .single();
  if (error || !inserted) {
    throw new Error(
      `chat_actor_insert_failed: ${error?.message ?? 'unknown'}`,
    );
  }
  return {
    userId: inserted.id,
    displayName: anon.displayName,
    walletAddress: null,
    isAnonymous: true,
    tokenBalance: '0',
  };
}
