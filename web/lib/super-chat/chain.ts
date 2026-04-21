import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  type Address,
  type Hex,
  type Log,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';

import { getChainId } from '@/lib/chain';
import { paymentsAbi } from './abi';

function rpcUrl(chainId: 8453 | 84532): string | undefined {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (!key) return undefined;
  const slug = chainId === 8453 ? 'base-mainnet' : 'base-sepolia';
  return `https://${slug}.g.alchemy.com/v2/${key}`;
}

// `createPublicClient` resolves to a specific viem version pulled in
// by wagmi; the `base` / `baseSepolia` chains here resolve through a
// different hoisted copy. Both are identical at runtime — we pass
// the options through `unknown` to sidestep the duplicate-type clash.
function client(): ReturnType<typeof createPublicClient> {
  const chainId = getChainId();
  const opts = {
    chain: chainId === 8453 ? base : baseSepolia,
    transport: http(rpcUrl(chainId)),
  } as unknown as Parameters<typeof createPublicClient>[0];
  return createPublicClient(opts);
}

export function paymentsAddress(): Address {
  const raw = process.env.NEXT_PUBLIC_PAYMENTS_ADDRESS;
  if (!raw) throw new Error('NEXT_PUBLIC_PAYMENTS_ADDRESS not set');
  return getAddress(raw);
}

export interface VerifiedSuperChat {
  payer: Address;
  streamerId: Hex;
  owner: Address;
  tier: number;
  amount: bigint;
  messageHash: Hex;
  timestamp: bigint;
  blockNumber: bigint;
}

/**
 * Given a tx hash, confirm it (a) targeted the Payments contract and
 * (b) emitted a matching SuperChat event. Returns null if anything is
 * off so the caller decides whether to 400 or 500.
 */
export async function verifySuperChatTx(
  txHash: Hex,
  expected: {
    tier: number;
    tierAmount: bigint;
    messageHash: Hex;
    streamerIdBytes32: Hex;
    streamerOwner: Address;
  },
): Promise<VerifiedSuperChat | null> {
  const publicClient = client();
  const payments = paymentsAddress();

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return null;
  }
  if (!receipt) return null;
  if (receipt.status !== 'success') return null;

  // The transaction MUST target the Payments contract directly. This
  // prevents a user from faking a SuperChat event via a malicious
  // contract that logs one without actually moving tokens.
  const to = receipt.to ? getAddress(receipt.to) : null;
  if (!to || to !== payments) return null;

  for (const rawLog of receipt.logs) {
    if (getAddress(rawLog.address) !== payments) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: paymentsAbi,
        eventName: 'SuperChat',
        topics: rawLog.topics,
        data: rawLog.data,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== 'SuperChat') continue;
    const args = decoded.args;

    if (args.streamerId.toLowerCase() !== expected.streamerIdBytes32.toLowerCase())
      return null;
    if (Number(args.tier) !== expected.tier) return null;
    if (args.messageHash.toLowerCase() !== expected.messageHash.toLowerCase())
      return null;
    if (getAddress(args.owner) !== getAddress(expected.streamerOwner))
      return null;
    if (args.amount !== expected.tierAmount) return null;

    return {
      payer: getAddress(args.payer),
      streamerId: args.streamerId as Hex,
      owner: getAddress(args.owner),
      tier: Number(args.tier),
      amount: args.amount,
      messageHash: args.messageHash as Hex,
      timestamp: args.timestamp,
      blockNumber: receipt.blockNumber,
    };
  }
  return null;
}

/**
 * Read the on-chain tier amounts (base units). Intentionally *not*
 * cached so admin updates take effect immediately.
 */
export async function readTierAmounts(): Promise<
  Record<1 | 2 | 3, bigint>
> {
  const payments = paymentsAddress();
  const publicClient = client();
  const [t1, t2, t3] = await Promise.all([
    publicClient.readContract({
      address: payments,
      abi: paymentsAbi,
      functionName: 'superChatTierAmounts',
      args: [1],
    }),
    publicClient.readContract({
      address: payments,
      abi: paymentsAbi,
      functionName: 'superChatTierAmounts',
      args: [2],
    }),
    publicClient.readContract({
      address: payments,
      abi: paymentsAbi,
      functionName: 'superChatTierAmounts',
      args: [3],
    }),
  ]);
  return { 1: t1, 2: t2, 3: t3 };
}

// Re-export for clients that just want the raw decoder.
export { decodeEventLog, type Log };
