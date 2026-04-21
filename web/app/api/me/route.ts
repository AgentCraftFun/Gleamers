import { NextResponse } from 'next/server';
import {
  readOrCreateAnonymous,
  readSession,
} from '@/lib/auth/session';
import { createSupabaseAdmin } from '@/lib/supabase';
import { getCachedBalance, isTokenLive } from '@/lib/token-balance';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

export async function GET() {
  const session = await readSession();

  if (session) {
    // Authenticated (wallet) user
    const sb = createSupabaseAdmin();
    const { data: user } = await sb
      .from('users')
      .select('id, wallet_address, display_name, is_admin')
      .eq('id', session.userId)
      .maybeSingle();
    if (!user) {
      // Stale session — fall through to anonymous
    } else {
      let balance: string | null = null;
      if (isTokenLive() && user.wallet_address) {
        try {
          balance = await getCachedBalance(user.id, user.wallet_address);
        } catch (err) {
          console.warn('[me] balance read failed', err);
        }
      }
      return NextResponse.json({
        id: user.id,
        wallet_address: user.wallet_address,
        display_name: user.display_name,
        is_admin: user.is_admin,
        is_anonymous: false,
        token_balance_cached: balance,
      });
    }
  }

  // Anonymous — ensures cookie is set so future requests recognise
  // the same visitor. We do NOT create a users row here; that happens
  // lazily on first chat attempt.
  const anon = readOrCreateAnonymous();
  return NextResponse.json({
    id: null,
    wallet_address: null,
    display_name: anon.displayName,
    is_admin: false,
    is_anonymous: true,
    anonymous_id: anon.anonymousId,
    token_balance_cached: null,
  });
}
