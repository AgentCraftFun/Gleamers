import { NextResponse } from 'next/server';
import { SiweMessage } from 'siwe';

import { createSupabaseAdmin } from '@/lib/supabase';
import { isAdminWallet } from '@/lib/auth/admins';
import {
  consumeNonceCookie,
  createSession,
} from '@/lib/auth/session';
import { truncateWallet } from '@/lib/format';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  message: string;
  signature: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body?.message || !body?.signature) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const expectedNonce = consumeNonceCookie();
  if (!expectedNonce) {
    return NextResponse.json({ error: 'nonce_missing' }, { status: 400 });
  }

  let siwe: SiweMessage;
  try {
    siwe = new SiweMessage(body.message);
  } catch (err) {
    return NextResponse.json(
      { error: 'invalid_message', detail: String(err) },
      { status: 400 },
    );
  }

  if (siwe.nonce !== expectedNonce) {
    return NextResponse.json({ error: 'nonce_mismatch' }, { status: 401 });
  }

  let verification;
  try {
    verification = await siwe.verify({ signature: body.signature });
  } catch (err) {
    return NextResponse.json(
      { error: 'verify_failed', detail: String(err) },
      { status: 401 },
    );
  }
  if (!verification.success) {
    return NextResponse.json(
      { error: 'signature_invalid' },
      { status: 401 },
    );
  }

  const wallet = siwe.address.toLowerCase();
  const admin = isAdminWallet(wallet);

  // Upsert users row.
  const sb = createSupabaseAdmin();
  const { data: existing, error: findErr } = await sb
    .from('users')
    .select('id, is_admin, display_name')
    .eq('wallet_address', wallet)
    .maybeSingle();
  if (findErr) {
    return NextResponse.json(
      { error: 'db_error', detail: findErr.message },
      { status: 500 },
    );
  }

  let userId: string;
  if (existing) {
    userId = existing.id;
    if (admin && !existing.is_admin) {
      await sb.from('users').update({ is_admin: true }).eq('id', userId);
    }
  } else {
    const { data: inserted, error: insErr } = await sb
      .from('users')
      .insert({
        wallet_address: wallet,
        display_name: truncateWallet(wallet),
        is_admin: admin,
      })
      .select('id')
      .single();
    if (insErr || !inserted) {
      return NextResponse.json(
        { error: 'insert_failed', detail: insErr?.message ?? 'unknown' },
        { status: 500 },
      );
    }
    userId = inserted.id;
  }

  await createSession({
    userId,
    walletAddress: wallet,
    isAdmin: admin,
  });

  return NextResponse.json({
    ok: true,
    userId,
    walletAddress: wallet,
    isAdmin: admin,
  });
}
