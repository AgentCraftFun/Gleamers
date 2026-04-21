import type { SessionType } from '@gleamers/shared';

function baseUrl(): string {
  return (
    process.env.ORCHESTRATOR_URL ??
    process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
    'http://localhost:4000'
  ).replace(/\/$/, '');
}

export interface StartSessionResult {
  ok: boolean;
  sessionId?: string;
  workerPort?: number;
  endsAt?: string;
  status?: number;
  error?: string;
}

/**
 * Server-to-server wrapper around POST /streamers/:slug/start.
 * Always sends the ORCHESTRATOR_API_KEY header; the server route is
 * protected. Returns structured result instead of throwing so the
 * caller can decide whether to surface the error.
 */
export async function orchestratorStartSession(
  slug: string,
  sessionType: SessionType = 'debut',
): Promise<StartSessionResult> {
  const key = process.env.ORCHESTRATOR_API_KEY;
  if (!key) {
    return {
      ok: false,
      status: 503,
      error: 'ORCHESTRATOR_API_KEY not configured on web backend',
    };
  }
  try {
    const res = await fetch(
      `${baseUrl()}/streamers/${encodeURIComponent(slug)}/start`,
      {
        method: 'POST',
        cache: 'no-store',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({ sessionType }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      return { ok: false, status: res.status, error: body || res.statusText };
    }
    const body = (await res.json()) as {
      sessionId: string;
      workerPort: number;
      endsAt: string;
    };
    return {
      ok: true,
      status: res.status,
      sessionId: body.sessionId,
      workerPort: body.workerPort,
      endsAt: body.endsAt,
    };
  } catch (err) {
    return { ok: false, status: 500, error: String(err) };
  }
}
