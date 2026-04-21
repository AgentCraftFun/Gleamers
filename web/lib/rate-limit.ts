import { getRedis } from './redis';

export interface RateLimitRule {
  /** Max hits within windowMs. */
  max: number;
  /** Window in milliseconds. */
  windowMs: number;
}

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

// In-memory fallback — fine for dev + single-instance deploys.
const memoryStore = new Map<string, number[]>();

async function checkInMemory(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitCheck> {
  const now = Date.now();
  const cutoff = now - rule.windowMs;
  const existing = memoryStore.get(key) ?? [];
  const fresh = existing.filter((t) => t >= cutoff);
  if (fresh.length >= rule.max) {
    const oldest = fresh[0] ?? now;
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: Math.max(0, oldest + rule.windowMs - now),
    };
  }
  fresh.push(now);
  memoryStore.set(key, fresh);
  return { allowed: true, remaining: rule.max - fresh.length, retryAfterMs: 0 };
}

async function checkRedis(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitCheck> {
  const redis = getRedis();
  if (!redis) return checkInMemory(key, rule);
  const now = Date.now();
  const windowKey = `${key}:${Math.floor(now / rule.windowMs)}`;
  try {
    const count = await redis.incr(windowKey);
    if (count === 1) {
      await redis.pexpire(windowKey, rule.windowMs);
    }
    if (count > rule.max) {
      const ttl = await redis.pttl(windowKey);
      return {
        allowed: false,
        remaining: 0,
        retryAfterMs: Math.max(0, ttl),
      };
    }
    return {
      allowed: true,
      remaining: Math.max(0, rule.max - count),
      retryAfterMs: 0,
    };
  } catch (err) {
    console.warn('[rate-limit] redis failed, falling back:', err);
    return checkInMemory(key, rule);
  }
}

export async function checkRateLimit(
  key: string,
  rule: RateLimitRule,
): Promise<RateLimitCheck> {
  return getRedis() ? checkRedis(key, rule) : checkInMemory(key, rule);
}

export const CHAT_RULES = {
  burst: { key: 'burst', max: 5, windowMs: 10_000 },
  sustained: { key: 'sustained', max: 20, windowMs: 5 * 60_000 },
  ip: { key: 'ip', max: 50, windowMs: 5 * 60_000 },
} as const;
