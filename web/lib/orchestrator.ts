export interface ActiveStreamer {
  slug: string;
  sessionId: string;
  sessionType: 'debut' | 'normal' | 'revival';
  viewers: number;
  secondsRemaining: number;
}

export function orchestratorUrl(): string {
  return (
    process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
    'http://localhost:4000'
  ).replace(/\/$/, '');
}

async function safeJson<T>(
  url: string,
  init?: RequestInit,
): Promise<T | null> {
  try {
    const res = await fetch(url, { cache: 'no-store', ...init });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

export async function fetchActive(): Promise<ActiveStreamer[]> {
  const rows = await safeJson<ActiveStreamer[]>(
    `${orchestratorUrl()}/streamers/active`,
  );
  return rows ?? [];
}

export async function fetchSpeakingStatus(): Promise<Record<string, boolean>> {
  const rows = await safeJson<Record<string, boolean>>(
    `${orchestratorUrl()}/streamers/speaking-status`,
  );
  return rows ?? {};
}
