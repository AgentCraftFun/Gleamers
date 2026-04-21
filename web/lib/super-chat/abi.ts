/**
 * Minimal Payments ABI for client writes + server verification.
 * Keep in sync with contracts/src/Payments.sol.
 */
export const paymentsAbi = [
  {
    type: 'function',
    stateMutability: 'nonpayable',
    name: 'superChat',
    inputs: [
      { name: 'streamerId', type: 'bytes32' },
      { name: 'tier', type: 'uint8' },
      { name: 'messageHash', type: 'bytes32' },
      { name: 'streamerOwner', type: 'address' },
    ],
    outputs: [],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'superChatTierAmounts',
    inputs: [{ name: 'tier', type: 'uint8' }],
    outputs: [{ type: 'uint256' }],
  },
  {
    type: 'function',
    stateMutability: 'view',
    name: 'paused',
    inputs: [],
    outputs: [{ type: 'bool' }],
  },
  {
    type: 'event',
    name: 'SuperChat',
    inputs: [
      { name: 'payer', type: 'address', indexed: true },
      { name: 'streamerId', type: 'bytes32', indexed: true },
      { name: 'owner', type: 'address', indexed: true },
      { name: 'tier', type: 'uint8', indexed: false },
      { name: 'amount', type: 'uint256', indexed: false },
      { name: 'messageHash', type: 'bytes32', indexed: false },
      { name: 'timestamp', type: 'uint256', indexed: false },
    ],
  },
] as const;
