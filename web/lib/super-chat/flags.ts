export function isTokenLive(): boolean {
  return process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
}
