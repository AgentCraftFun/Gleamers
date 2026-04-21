import { NextResponse } from 'next/server';
import { mintNonce, setNonceCookie } from '@/lib/auth/session';

export const dynamic = 'force-dynamic';

export async function GET() {
  const nonce = mintNonce();
  setNonceCookie(nonce);
  return NextResponse.json({ nonce });
}
