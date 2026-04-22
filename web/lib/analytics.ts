'use client';

import posthog from 'posthog-js';

/**
 * Thin PostHog wrapper. All call-sites go through the typed helpers
 * below so rename/remove refactors land in one place.
 *
 * No-op in SSR and when NEXT_PUBLIC_POSTHOG_KEY is unset.
 */

let initialized = false;

function init(): typeof posthog | null {
  if (typeof window === 'undefined') return null;
  const key = process.env.NEXT_PUBLIC_POSTHOG_KEY;
  if (!key) return null;
  if (!initialized) {
    posthog.init(key, {
      api_host:
        process.env.NEXT_PUBLIC_POSTHOG_HOST ?? 'https://us.i.posthog.com',
      capture_pageview: true,
      persistence: 'localStorage+cookie',
    });
    initialized = true;
  }
  return posthog;
}

export type AnalyticsEvent =
  | { name: 'stream_view_start'; slug: string; sessionType: 'debut' | 'normal' | 'revival' | 'unknown' }
  | { name: 'stream_view_end'; slug: string; durationSec: number }
  | { name: 'chat_sent'; slug: string; isAnonymous: boolean }
  | {
      name: 'super_chat_sent';
      slug: string;
      tier: 1 | 2 | 3;
      amount: string;
      txHash: string;
    }
  | { name: 'streamer_deployed'; slug: string; feePaid: string }
  | { name: 'go_live_clicked'; slug: string }
  | { name: 'wallet_connected'; address: string };

export function track(event: AnalyticsEvent): void {
  const client = init();
  if (!client) return;
  const { name, ...props } = event;
  try {
    client.capture(name, props as Record<string, unknown>);
  } catch {
    /* best-effort — analytics must never throw */
  }
}

export function identify(distinctId: string, props?: Record<string, unknown>): void {
  const client = init();
  if (!client) return;
  try {
    client.identify(distinctId, props);
  } catch {
    /* noop */
  }
}

export function reset(): void {
  const client = init();
  if (!client) return;
  try {
    client.reset();
  } catch {
    /* noop */
  }
}
