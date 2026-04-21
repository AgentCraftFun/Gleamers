/**
 * OpenAI moderation wrapper. Returns `{ flagged, categories }`.
 * Silently returns `flagged: false` when OPENAI_API_KEY is absent
 * or the upstream call fails — moderation is best-effort and must
 * never block the chat pipeline during development.
 */

export interface ModerationResult {
  flagged: boolean;
  reason?: string;
  categories?: string[];
}

export async function moderate(content: string): Promise<ModerationResult> {
  const key = process.env.OPENAI_API_KEY;
  if (!key) return { flagged: false };

  try {
    const res = await fetch('https://api.openai.com/v1/moderations', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${key}`,
      },
      body: JSON.stringify({
        model: 'omni-moderation-latest',
        input: content,
      }),
    });
    if (!res.ok) {
      console.warn(`[moderate] ${res.status} ${res.statusText}`);
      return { flagged: false };
    }
    type ModerationResponse = {
      results?: Array<{
        flagged?: boolean;
        categories?: Record<string, boolean>;
      }>;
    };
    const body = (await res.json()) as ModerationResponse;
    const result = body.results?.[0];
    if (!result?.flagged) return { flagged: false };
    const hits = Object.entries(result.categories ?? {})
      .filter(([, v]) => v === true)
      .map(([k]) => k);
    return {
      flagged: true,
      reason: 'moderation_blocked',
      categories: hits,
    };
  } catch (err) {
    console.warn('[moderate] threw, treating as safe:', err);
    return { flagged: false };
  }
}
