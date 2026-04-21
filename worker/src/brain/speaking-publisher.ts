import { Redis } from 'ioredis';

const SPEAKING_KEY = 'gleamers:speaking';
const TICK_MS = 500;
const QUIET_GAP_MS = 600;

/**
 * Publishes a boolean "is speaking" flag to Redis HSET under
 * gleamers:speaking for this streamer slug, every ~500ms. The
 * orchestrator reads the hash for homepage waveforms etc.
 *
 *   markActive() bumps the last-audio timestamp; the ticker writes
 *   "true" if that was within QUIET_GAP_MS, else "false".
 *
 * Falls back to a no-op if REDIS_URL isn't set.
 */
export class SpeakingPublisher {
  private redis: Redis | null = null;
  private timer: NodeJS.Timeout | null = null;
  private lastAudioAt = 0;
  private lastWrote: boolean | null = null;
  private readonly slug: string;

  constructor(slug: string) {
    this.slug = slug;
  }

  start(): void {
    const url = process.env.REDIS_URL;
    if (!url) return;
    try {
      this.redis = new Redis(url, {
        maxRetriesPerRequest: 2,
        lazyConnect: false,
      });
      this.redis.on('error', (err) => {
        // swallow — publisher is best-effort
        console.warn('[speaking] redis error:', err.message);
      });
    } catch (err) {
      console.warn('[speaking] redis init failed:', err);
      return;
    }
    this.timer = setInterval(() => this.tick(), TICK_MS);
  }

  markActive(): void {
    this.lastAudioAt = Date.now();
  }

  private async tick(): Promise<void> {
    if (!this.redis) return;
    const speaking = Date.now() - this.lastAudioAt < QUIET_GAP_MS;
    if (speaking === this.lastWrote) return;
    this.lastWrote = speaking;
    try {
      await this.redis.hset(SPEAKING_KEY, this.slug, speaking ? 'true' : 'false');
    } catch {
      /* best-effort */
    }
  }

  async stop(): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    if (this.redis) {
      try {
        await this.redis.hdel(SPEAKING_KEY, this.slug);
      } catch {
        /* noop */
      }
      this.redis.disconnect();
      this.redis = null;
    }
  }
}
