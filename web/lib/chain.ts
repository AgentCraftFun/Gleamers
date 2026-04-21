/**
 * Server-safe helper for the active chain ID. Split out from
 * lib/wagmi.ts so server routes can read it without pulling in
 * RainbowKit (which is strictly client-side).
 */
export function getChainId(): 8453 | 84532 {
  const raw = Number(process.env.NEXT_PUBLIC_CHAIN_ID ?? '84532');
  return raw === 8453 ? 8453 : 84532;
}
