import { createPublicClient, http, erc20Abi, getAddress } from 'viem';
import { base, baseSepolia } from 'viem/chains';

import { createSupabaseAdmin } from '@/lib/supabase';
import { getChainId } from '@/lib/chain';

const CACHE_TTL_MS = 5 * 60 * 1000;

export function isTokenLive(): boolean {
  return process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
}

function alchemyUrl(chainId: number): string | undefined {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (!key) return undefined;
  const slug = chainId === 8453 ? 'base-mainnet' : 'base-sepolia';
  return `https://${slug}.g.alchemy.com/v2/${key}`;
}

function rpcChain(chainId: number) {
  return chainId === 8453 ? base : baseSepolia;
}

/**
 * Read the user's utility-token balance on Base (via Alchemy).
 * Returns 0n when TOKEN_LIVE=false, when the contract address is
 * missing, or when the RPC call fails. Never throws — balance UI is
 * cosmetic.
 */
export async function fetchOnchainBalance(
  wallet: string,
): Promise<bigint> {
  if (!isTokenLive()) return 0n;
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;
  if (!tokenAddress) return 0n;

  const chainId = getChainId();
  const rpc = alchemyUrl(chainId);
  try {
    const client = createPublicClient({
      chain: rpcChain(chainId),
      transport: http(rpc),
    });
    const balance = await client.readContract({
      address: getAddress(tokenAddress),
      abi: erc20Abi,
      functionName: 'balanceOf',
      args: [getAddress(wallet)],
    });
    return balance as bigint;
  } catch (err) {
    console.warn('[token-balance] rpc read failed', err);
    return 0n;
  }
}

/**
 * Return the cached token balance; refresh from chain if stale.
 * Writes back to users.token_balance_cached. Returns the raw balance
 * as a string to avoid JSON bigint headaches.
 */
export async function getCachedBalance(
  userId: string,
  wallet: string,
): Promise<string> {
  if (!isTokenLive()) return '0';
  const sb = createSupabaseAdmin();

  const { data: user } = await sb
    .from('users')
    .select('token_balance_cached, token_balance_updated_at')
    .eq('id', userId)
    .maybeSingle();

  const now = Date.now();
  const updatedAt = user?.token_balance_updated_at
    ? new Date(user.token_balance_updated_at).getTime()
    : 0;

  if (user?.token_balance_cached && now - updatedAt < CACHE_TTL_MS) {
    return user.token_balance_cached;
  }

  const fresh = await fetchOnchainBalance(wallet);
  const asString = fresh.toString();
  await sb
    .from('users')
    .update({
      token_balance_cached: asString,
      token_balance_updated_at: new Date().toISOString(),
    })
    .eq('id', userId);
  return asString;
}
