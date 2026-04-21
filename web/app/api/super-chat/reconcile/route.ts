/**
 * Reconciliation endpoint for the case where the client's superChat
 * tx confirmed on chain but /submit never finished the handshake
 * (network drop, tab close, etc). Same contract as /submit — the
 * finaliser is idempotent.
 */
import { NextResponse } from 'next/server';
import { isTokenLive } from '@/lib/token-balance';
import { finalizeSuperChat } from '@/lib/super-chat/finalize';

export const dynamic = 'force-dynamic';
export const runtime = 'nodejs';

interface Body {
  pendingId?: string;
  txHash?: string;
}

export async function POST(req: Request) {
  if (!isTokenLive()) {
    return NextResponse.json({ error: 'token_not_live' }, { status: 503 });
  }
  let body: Body;
  try {
    body = (await req.json()) as Body;
  } catch {
    return NextResponse.json({ error: 'invalid_json' }, { status: 400 });
  }
  if (!body.pendingId || !body.txHash) {
    return NextResponse.json({ error: 'missing_fields' }, { status: 400 });
  }

  const result = await finalizeSuperChat({
    pendingId: body.pendingId,
    txHash: body.txHash,
  });
  return NextResponse.json(result.body, { status: result.status });
}
