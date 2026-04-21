import { readFile, stat } from 'node:fs/promises';
import { resolve, isAbsolute } from 'node:path';

/**
 * Hot-reloadable chat blocklist.
 *
 * File shape (see config/README.md):
 *   { "exact": string[], "regex": string[] }
 *
 * `exact` is case-insensitive substring match; `regex` sources are
 * compiled with the `i` flag. Blocklist hits should short-circuit
 * the chat pipeline before the OpenAI moderation call.
 */

export interface BlocklistMatch {
  blocked: true;
  /** `exact:<word>` | `regex:<source>` — stored on moderation_events.reason. */
  reason: string;
}

export type BlocklistResult = BlocklistMatch | { blocked: false };

interface CompiledList {
  exact: string[];
  regex: RegExp[];
}

const RELOAD_THROTTLE_MS = 2000;

let cached: { mtimeMs: number; list: CompiledList } | null = null;
let lastLoadAttempt = 0;

function resolvePath(): string {
  const override = process.env.BLOCKLIST_PATH;
  if (override) {
    return isAbsolute(override) ? override : resolve(process.cwd(), override);
  }
  // Default: config/blocklist.json at the repo root (web's cwd is web/).
  return resolve(process.cwd(), '../config/blocklist.json');
}

async function readIfChanged(): Promise<void> {
  const now = Date.now();
  if (cached && now - lastLoadAttempt < RELOAD_THROTTLE_MS) return;
  lastLoadAttempt = now;

  const path = resolvePath();
  let stats;
  try {
    stats = await stat(path);
  } catch {
    cached = { mtimeMs: 0, list: { exact: [], regex: [] } };
    return;
  }
  if (cached && cached.mtimeMs === stats.mtimeMs) return;

  try {
    const raw = await readFile(path, 'utf8');
    const json = JSON.parse(raw) as { exact?: unknown; regex?: unknown };
    const exact: string[] = Array.isArray(json.exact)
      ? (json.exact as unknown[])
          .filter((s): s is string => typeof s === 'string')
          .map((s) => s.toLowerCase())
      : [];
    const regex: RegExp[] = Array.isArray(json.regex)
      ? (json.regex as unknown[])
          .filter((s): s is string => typeof s === 'string')
          .flatMap((source) => {
            try {
              return [new RegExp(source, 'i')];
            } catch (err) {
              console.warn(`[blocklist] bad regex skipped: ${source}`, err);
              return [] as RegExp[];
            }
          })
      : [];
    cached = { mtimeMs: stats.mtimeMs, list: { exact, regex } };
  } catch (err) {
    console.warn('[blocklist] parse failed; using empty list:', err);
    cached = { mtimeMs: stats.mtimeMs, list: { exact: [], regex: [] } };
  }
}

export async function checkBlocklist(
  content: string,
): Promise<BlocklistResult> {
  await readIfChanged();
  const list = cached?.list ?? { exact: [], regex: [] };
  const lower = content.toLowerCase();
  for (const term of list.exact) {
    if (term && lower.includes(term)) {
      return { blocked: true, reason: `blocklist:exact:${term}` };
    }
  }
  for (const rx of list.regex) {
    if (rx.test(content)) {
      return { blocked: true, reason: `blocklist:regex:${rx.source}` };
    }
  }
  return { blocked: false };
}
