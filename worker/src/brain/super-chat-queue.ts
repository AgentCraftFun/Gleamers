import type { SuperChatTier } from '@gleamers/shared';
import { SuperChatTier as SuperChatTierEnum } from '@gleamers/shared';

export interface SuperChatItem {
  messageId: string;
  userId: string;
  displayName: string;
  content: string;
  tier: SuperChatTier;
  amount?: string;
  createdAt: string;
}

const DEFAULT_MIN_GAP_MS = 30_000;

/**
 * FIFO priority queue for super-chats: tier 3 first, then 2, then 1.
 * Within a tier, earliest-received goes first.
 *
 * Adds a "breathing room" policy so the streamer doesn't read 20
 * super chats in a row:
 *  - Tier 3 always preempts (`shouldPickNow()` returns true if the
 *    top of the queue is Tier 3, regardless of recency).
 *  - Otherwise, pickNext() holds off until at least `minGapMs` has
 *    elapsed since the last addressed super chat.
 */
export class SuperChatQueue {
  private items: SuperChatItem[] = [];
  private lastAddressedAt = 0;
  private readonly minGapMs: number;

  constructor(opts: { minGapMs?: number } = {}) {
    this.minGapMs = opts.minGapMs ?? DEFAULT_MIN_GAP_MS;
  }

  push(item: SuperChatItem): void {
    this.items.push(item);
    this.items.sort((a, b) => {
      if (a.tier !== b.tier) return b.tier - a.tier;
      return (
        new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()
      );
    });
  }

  get size(): number {
    return this.items.length;
  }

  peek(): SuperChatItem | null {
    return this.items[0] ?? null;
  }

  /**
   * True when the caller should pop now: queue non-empty AND either
   * the top is Tier 3 or enough time has elapsed since the last
   * addressed super chat.
   */
  shouldPickNow(now = Date.now()): boolean {
    const head = this.items[0];
    if (!head) return false;
    if (head.tier === SuperChatTierEnum.TIER_3) return true;
    return now - this.lastAddressedAt >= this.minGapMs;
  }

  /**
   * Pop the top item only if `shouldPickNow()` agrees. Records the
   * address timestamp so the gap rule applies on subsequent calls.
   */
  pickNext(now = Date.now()): SuperChatItem | null {
    if (!this.shouldPickNow(now)) return null;
    const item = this.items.shift();
    if (!item) return null;
    this.lastAddressedAt = now;
    return item;
  }
}
