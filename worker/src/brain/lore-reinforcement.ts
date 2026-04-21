import type { StreamerLoreRow } from '@gleamers/shared';
import { getSupabase } from '../supabase.js';

/**
 * Jaccard-based fuzzy reinforcement. After each AI response, any lore
 * row whose content tokens overlap the response's tokens by >= 40% of
 * the smaller set gets a +0.2 relevance bump (capped at 2.0). Cheap
 * + best-effort; errors are swallowed.
 */

const MATCH_THRESHOLD = 0.4;
const BUMP = 0.2;
const CAP = 2.0;

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 2),
  );
}

function overlapRatio(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  return inter / Math.min(a.size, b.size);
}

export async function reinforceLore(
  streamerId: string,
  lore: StreamerLoreRow[],
  responseText: string,
): Promise<string[]> {
  if (lore.length === 0 || responseText.length === 0) return [];
  const respTokens = tokenize(responseText);
  if (respTokens.size < 3) return [];

  const bumped: string[] = [];
  for (const row of lore) {
    const ratio = overlapRatio(tokenize(row.content), respTokens);
    if (ratio < MATCH_THRESHOLD) continue;
    const newScore = Math.min(CAP, (row.relevance_score ?? 1) + BUMP);
    if (newScore === row.relevance_score) continue;
    row.relevance_score = newScore; // update in-memory copy too
    bumped.push(row.id);
    try {
      const sb = getSupabase();
      await sb
        .from('streamer_lore')
        .update({ relevance_score: newScore })
        .eq('id', row.id);
    } catch (err) {
      console.warn('[lore-reinforcement] update failed:', err);
    }
  }
  if (bumped.length > 0) {
    console.log(
      `[lore-reinforcement] bumped ${bumped.length} rows for streamer ${streamerId}`,
    );
  }
  return bumped;
}
