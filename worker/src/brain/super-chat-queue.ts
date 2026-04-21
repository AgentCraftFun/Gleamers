import type { SuperChatTier } from '@gleamers/shared';

export interface SuperChatItem {
  messageId: string;
  userId: string;
  displayName: string;
  content: string;
  tier: SuperChatTier;
  createdAt: string;
}

/**
 * FIFO priority queue for super-chats: tier 3 first, then 2, then 1.
 * Within a tier, earliest-received goes first. Used by the session
 * loop to preempt normal chat/monologue selection.
 */
export class SuperChatQueue {
  private items: SuperChatItem[] = [];

  push(item: SuperChatItem): void {
    this.items.push(item);
    // Stable sort by tier desc, then createdAt asc.
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

  pickNext(): SuperChatItem | null {
    return this.items.shift() ?? null;
  }

  peek(): SuperChatItem | null {
    return this.items[0] ?? null;
  }
}
