import { Redis } from 'ioredis';

let client: Redis | null = null;
let warned = false;

export const SPEAKING_KEY = 'gleamers:speaking';

export function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!warned) {
      console.warn(
        '[orch] REDIS_URL not set — speaking-status and other Redis-backed features are disabled.',
      );
      warned = true;
    }
    return null;
  }
  client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  client.on('error', (err) => {
    console.warn('[orch] redis error:', err.message);
  });
  return client;
}
