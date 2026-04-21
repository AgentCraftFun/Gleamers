import { SignJWT, jwtVerify } from 'jose';
import { cookies } from 'next/headers';
import { randomBytes, randomUUID } from 'node:crypto';

export const SESSION_COOKIE = 'gleamers_session';
export const NONCE_COOKIE = 'gleamers_siwe_nonce';
export const ANON_COOKIE = 'gleamers_anon';

const SESSION_MAX_AGE_S = 7 * 24 * 60 * 60; // 1 week
const ANON_MAX_AGE_S = 365 * 24 * 60 * 60; // 1 year

export interface SessionPayload {
  userId: string;
  walletAddress: string;
  isAdmin: boolean;
}

export interface AnonymousIdentity {
  anonymousId: string;
  displayName: string;
}

function sessionSecret(): Uint8Array {
  const raw = process.env.AUTH_SECRET;
  if (!raw || raw.length < 16) {
    throw new Error(
      'AUTH_SECRET env is required and must be at least 16 chars',
    );
  }
  return new TextEncoder().encode(raw);
}

function isProd(): boolean {
  return process.env.NODE_ENV === 'production';
}

export async function createSession(payload: SessionPayload): Promise<void> {
  const token = await new SignJWT({ ...payload })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_S}s`)
    .sign(sessionSecret());

  cookies().set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_MAX_AGE_S,
  });
}

export async function readSession(): Promise<SessionPayload | null> {
  const cookie = cookies().get(SESSION_COOKIE)?.value;
  if (!cookie) return null;
  try {
    const { payload } = await jwtVerify(cookie, sessionSecret());
    const { userId, walletAddress, isAdmin } = payload as Partial<SessionPayload>;
    if (!userId || !walletAddress) return null;
    return {
      userId: String(userId),
      walletAddress: String(walletAddress),
      isAdmin: Boolean(isAdmin),
    };
  } catch {
    return null;
  }
}

export function clearSession(): void {
  cookies().set(SESSION_COOKIE, '', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
}

// ---------------------------------------------------------------------------
// SIWE nonce cookie
// ---------------------------------------------------------------------------

export function setNonceCookie(nonce: string): void {
  cookies().set(NONCE_COOKIE, nonce, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 10 * 60,
  });
}

export function consumeNonceCookie(): string | null {
  const v = cookies().get(NONCE_COOKIE)?.value ?? null;
  cookies().set(NONCE_COOKIE, '', {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: 0,
  });
  return v;
}

export function mintNonce(): string {
  return randomBytes(16).toString('hex');
}

// ---------------------------------------------------------------------------
// Anonymous identity (persistent guest cookie)
// ---------------------------------------------------------------------------

function anonymousDisplayName(id: string): string {
  // First 4 hex chars of the UUID, uppercased.
  const compact = id.replace(/-/g, '');
  return `guest_${compact.slice(0, 4).toUpperCase()}`;
}

export function readOrCreateAnonymous(): AnonymousIdentity {
  const existing = cookies().get(ANON_COOKIE)?.value;
  if (existing) {
    return {
      anonymousId: existing,
      displayName: anonymousDisplayName(existing),
    };
  }
  const fresh = randomUUID();
  cookies().set(ANON_COOKIE, fresh, {
    httpOnly: true,
    secure: isProd(),
    sameSite: 'lax',
    path: '/',
    maxAge: ANON_MAX_AGE_S,
  });
  return {
    anonymousId: fresh,
    displayName: anonymousDisplayName(fresh),
  };
}

export function readAnonymousCookie(): string | null {
  return cookies().get(ANON_COOKIE)?.value ?? null;
}
