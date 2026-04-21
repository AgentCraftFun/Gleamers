import { NextResponse } from 'next/server';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readAnonymousCookie, readSession } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface Body {
  email?: string;
  source?: string;
}

export async function POST(req: Request) {
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  const email = (body.email ?? '').trim().toLowerCase();
  if (!EMAIL_RE.test(email)) {
    return NextResponse.json({ error: 'invalid_email' }, { status: 400 });
  }

  const session = await readSession();
  const anon = readAnonymousCookie();

  try {
    const sb = createSupabaseAdmin();
    const { error } = await sb
      .from('waitlist_emails')
      .upsert(
        {
          email,
          wallet_address: session?.walletAddress ?? null,
          source: body.source ?? 'deploy_gate',
        },
        { onConflict: 'email' },
      );
    if (error) {
      console.warn('[waitlist] insert failed:', error.message);
      return NextResponse.json(
        { error: 'insert_failed', detail: error.message },
        { status: 500 },
      );
    }
  } catch (err) {
    // No Supabase configured — log so devs can still see signups.
    console.log(
      `[waitlist] captured (no DB): email=${email} wallet=${session?.walletAddress ?? anon ?? 'anon'}`,
    );
  }

  return NextResponse.json({ ok: true });
}
