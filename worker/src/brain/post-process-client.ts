/**
 * Fire-and-forget call from the worker to the orchestrator's
 * /sessions/:id/post-process endpoint. The orchestrator runs the
 * summarisation + lore-extraction job async — we don't wait.
 */

function baseUrl(): string {
  return (
    process.env.ORCHESTRATOR_URL ??
    process.env.NEXT_PUBLIC_ORCHESTRATOR_URL ??
    'http://localhost:4000'
  ).replace(/\/$/, '');
}

export async function triggerPostProcess(sessionId: string): Promise<void> {
  const key = process.env.ORCHESTRATOR_API_KEY;
  if (!key) {
    console.warn('[post-process] ORCHESTRATOR_API_KEY unset; skipping trigger');
    return;
  }
  try {
    const res = await fetch(
      `${baseUrl()}/sessions/${encodeURIComponent(sessionId)}/post-process`,
      {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          'x-api-key': key,
        },
        body: JSON.stringify({ sessionId }),
      },
    );
    if (!res.ok) {
      const body = await res.text().catch(() => '');
      console.warn(
        `[post-process] trigger failed ${res.status}: ${body.slice(0, 200)}`,
      );
    }
  } catch (err) {
    console.warn('[post-process] trigger threw:', err);
  }
}
