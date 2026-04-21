import {
  createPublicClient,
  decodeEventLog,
  getAddress,
  http,
  parseAbi,
  type Address,
  type Hex,
} from 'viem';
import { base, baseSepolia } from 'viem/chains';

import { getChainId } from '@/lib/chain';
import { paymentsAbi } from '@/lib/super-chat/abi';
import { paymentsAddress } from '@/lib/super-chat/chain';

const DEPLOY_FEE_ABI = [
  ...paymentsAbi,
  ...parseAbi([
    'function deployFeeAmount() view returns (uint256)',
    'function payDeployFee(bytes32 deployId)',
    'event DeployFeePaid(address indexed payer, bytes32 indexed deployId, uint256 amount, uint256 burnAmount, uint256 treasuryAmount, uint256 timestamp)',
  ]),
] as const;

function rpcUrl(chainId: 8453 | 84532): string | undefined {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (!key) return undefined;
  const slug = chainId === 8453 ? 'base-mainnet' : 'base-sepolia';
  return `https://${slug}.g.alchemy.com/v2/${key}`;
}

function client(): ReturnType<typeof createPublicClient> {
  const chainId = getChainId();
  const opts = {
    chain: chainId === 8453 ? base : baseSepolia,
    transport: http(rpcUrl(chainId)),
  } as unknown as Parameters<typeof createPublicClient>[0];
  return createPublicClient(opts);
}

export { DEPLOY_FEE_ABI };

export async function readDeployFeeAmount(): Promise<bigint> {
  const amt = await client().readContract({
    address: paymentsAddress(),
    abi: DEPLOY_FEE_ABI,
    functionName: 'deployFeeAmount',
  });
  return amt as bigint;
}

export interface VerifiedDeployFee {
  payer: Address;
  deployId: Hex;
  amount: bigint;
  burnAmount: bigint;
  treasuryAmount: bigint;
  blockNumber: bigint;
}

/**
 * Confirm a deploy-fee tx on chain. Enforces:
 *  - status = success
 *  - receipt.to === paymentsAddress()
 *  - DeployFeePaid event emitted with matching deployId + amount
 */
export async function verifyDeployFeeTx(
  txHash: Hex,
  expected: {
    deployIdBytes32: Hex;
    expectedAmount: bigint;
  },
): Promise<VerifiedDeployFee | null> {
  const publicClient = client();
  const payments = paymentsAddress();

  let receipt;
  try {
    receipt = await publicClient.getTransactionReceipt({ hash: txHash });
  } catch {
    return null;
  }
  if (!receipt || receipt.status !== 'success') return null;
  const to = receipt.to ? getAddress(receipt.to) : null;
  if (!to || to !== payments) return null;

  for (const log of receipt.logs) {
    if (getAddress(log.address) !== payments) continue;
    let decoded;
    try {
      decoded = decodeEventLog({
        abi: DEPLOY_FEE_ABI,
        eventName: 'DeployFeePaid',
        topics: log.topics,
        data: log.data,
      });
    } catch {
      continue;
    }
    if (decoded.eventName !== 'DeployFeePaid') continue;
    const args = decoded.args;
    if (args.deployId.toLowerCase() !== expected.deployIdBytes32.toLowerCase())
      continue;
    if (args.amount !== expected.expectedAmount) return null;
    return {
      payer: getAddress(args.payer),
      deployId: args.deployId as Hex,
      amount: args.amount,
      burnAmount: args.burnAmount,
      treasuryAmount: args.treasuryAmount,
      blockNumber: receipt.blockNumber,
    };
  }
  return null;
}
