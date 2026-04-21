import { Redis } from 'ioredis';
import {
  CHAT_CHANNEL_PREFIX,
  type ChatPublishEnvelope,
} from '@gleamers/shared';

/**
 * Subscribes to the per-streamer chat channel in Redis and forwards
 * decoded envelopes to the provided handler. Falls back to a no-op
 * when REDIS_URL is not set — chat pub/sub is optional for dev.
 */
export class ChatSubscriber {
  private client: Redis | null = null;
  private channel: string;

  constructor(
    slug: string,
    private readonly onMessage: (env: ChatPublishEnvelope) => void,
  ) {
    this.channel = `${CHAT_CHANNEL_PREFIX}${slug}`;
  }

  start(): void {
    const url = process.env.REDIS_URL;
    if (!url) return;
    try {
      this.client = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
      });
      this.client.on('error', (err) =>
        console.warn('[chat-sub] redis error:', err.message),
      );
      this.client.subscribe(this.channel, (err) => {
        if (err) console.warn('[chat-sub] subscribe failed:', err);
      });
      this.client.on('message', (ch, msg) => {
        if (ch !== this.channel) return;
        try {
          const envelope = JSON.parse(msg) as ChatPublishEnvelope;
          this.onMessage(envelope);
        } catch (err) {
          console.warn('[chat-sub] bad payload:', err);
        }
      });
    } catch (err) {
      console.warn('[chat-sub] init failed:', err);
    }
  }

  async stop(): Promise<void> {
    if (!this.client) return;
    try {
      await this.client.unsubscribe(this.channel);
    } catch {
      /* noop */
    }
    this.client.disconnect();
    this.client = null;
  }
}
