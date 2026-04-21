'use client';

import { useMemo } from 'react';
import { erc20Abi, getAddress, type Address } from 'viem';
import { useReadContracts, useAccount, useReadContract } from 'wagmi';

import { paymentsAbi } from './abi';
import { isTokenLive } from './flags';

interface TierAmounts {
  loading: boolean;
  /** Raw base units per tier (from `superChatTierAmounts(n)`). */
  amounts: Record<1 | 2 | 3, bigint | null>;
  /** User's on-chain allowance on the Payments contract. */
  allowance: bigint | null;
  paymentsAddress: Address | null;
  tokenAddress: Address | null;
}

export function useTierAmounts(): TierAmounts {
  const { address } = useAccount();
  const live = isTokenLive();
  const paymentsAddress = process.env.NEXT_PUBLIC_PAYMENTS_ADDRESS;
  const tokenAddress = process.env.NEXT_PUBLIC_TOKEN_ADDRESS;

  const enabled = Boolean(live && paymentsAddress && tokenAddress);
  const payments = enabled ? getAddress(paymentsAddress!) : null;
  const token = enabled ? getAddress(tokenAddress!) : null;

  const tierReads = useReadContracts({
    allowFailure: false,
    contracts:
      enabled && payments
        ? ([
            {
              address: payments,
              abi: paymentsAbi,
              functionName: 'superChatTierAmounts',
              args: [1],
            },
            {
              address: payments,
              abi: paymentsAbi,
              functionName: 'superChatTierAmounts',
              args: [2],
            },
            {
              address: payments,
              abi: paymentsAbi,
              functionName: 'superChatTierAmounts',
              args: [3],
            },
          ] as const)
        : [],
    query: { enabled },
  });

  const allowanceRead = useReadContract({
    address: token ?? undefined,
    abi: erc20Abi,
    functionName: 'allowance',
    args: address && payments ? [address, payments] : undefined,
    query: { enabled: Boolean(enabled && address && payments) },
  });

  return useMemo(() => {
    if (!enabled) {
      return {
        loading: false,
        amounts: { 1: null, 2: null, 3: null },
        allowance: null,
        paymentsAddress: null,
        tokenAddress: null,
      };
    }
    const [t1, t2, t3] = (tierReads.data ?? [null, null, null]) as Array<
      bigint | null
    >;
    return {
      loading: tierReads.isLoading || allowanceRead.isLoading,
      amounts: { 1: t1 ?? null, 2: t2 ?? null, 3: t3 ?? null },
      allowance:
        typeof allowanceRead.data === 'bigint' ? allowanceRead.data : null,
      paymentsAddress: payments,
      tokenAddress: token,
    };
  }, [
    enabled,
    tierReads.data,
    tierReads.isLoading,
    allowanceRead.data,
    allowanceRead.isLoading,
    payments,
    token,
  ]);
}
