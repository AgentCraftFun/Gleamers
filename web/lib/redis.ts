import { Redis } from 'ioredis';

let client: Redis | null = null;
let warned = false;

export function getRedis(): Redis | null {
  if (client) return client;
  const url = process.env.REDIS_URL;
  if (!url) {
    if (!warned) {
      console.warn(
        '[web] REDIS_URL not set — rate limits fall back to in-memory and chat pub/sub is disabled.',
      );
      warned = true;
    }
    return null;
  }
  client = new Redis(url, { maxRetriesPerRequest: 2, lazyConnect: false });
  client.on('error', (err) => console.warn('[web] redis:', err.message));
  return client;
}
