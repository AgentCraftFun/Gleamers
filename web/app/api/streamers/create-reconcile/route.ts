/**
 * Retry endpoint for the case where payDeployFee confirmed on chain
 * but /create-confirm never got the response back to the client.
 * Same handler as /create-confirm — idempotent.
 */
import { NextResponse } from 'next/server';
import { isTokenLive } from '@/lib/token-balance';
import { finalizeDeploy } from '@/lib/deploy/finalize';

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
  const result = await finalizeDeploy({
    pendingId: body.pendingId,
    txHash: body.txHash,
  });
  return NextResponse.json(result.body, { status: result.status });
}
