import { keccak256, toBytes, type Hex } from 'viem';

/**
 * Pack a UUID into bytes32 by stripping dashes and left-padding with
 * zeros. Deterministic, reversible, and readable on a block explorer.
 */
export function streamerIdToBytes32(streamerId: string): Hex {
  const hex = streamerId.replace(/-/g, '').toLowerCase();
  return `0x${hex.padStart(64, '0')}` as Hex;
}

/**
 * Stable message hash binding a pending id to message text + ts. Used
 * on-chain as the SuperChat.messageHash receipt and verified server
 * side when the tx confirms.
 */
export function buildMessageHash(
  pendingId: string,
  message: string,
  timestampMs: number,
): Hex {
  const bytes = toBytes(`${pendingId}:${message}:${timestampMs}`);
  return keccak256(bytes);
}
