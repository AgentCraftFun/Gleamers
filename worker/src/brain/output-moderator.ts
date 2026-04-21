import Anthropic from '@anthropic-ai/sdk';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

/**
 * Tiny per-sentence moderator using Claude Haiku. Runs right before
 * TTS synthesis in the streamer brain. Fails **open** on errors and
 * when disabled — moderation is best-effort and should never block
 * the session on upstream flakiness.
 *
 * The prompt is stable + terse on purpose: max_tokens=5 caps cost,
 * and the model returns "YES" or "NO" (sometimes with a trailing
 * punctuation or newline) which we parse lenient-ly.
 */
export interface OutputModeratorOptions {
  apiKey?: string;
  model?: string;
  /** Disable outright. Default: true unless OUTPUT_MODERATION=false. */
  enabled?: boolean;
}

const SYSTEM_PROMPT =
  'Is this single sentence inappropriate for a general audience streaming platform? ' +
  'Answer YES or NO.';

export class OutputModerator {
  private readonly client: Anthropic | null;
  private readonly model: string;
  private readonly enabled: boolean;

  constructor(opts: OutputModeratorOptions = {}) {
    const envEnabled = process.env.OUTPUT_MODERATION !== 'false';
    this.enabled = opts.enabled ?? envEnabled;
    this.model = opts.model ?? DEFAULT_MODEL;
    const key = opts.apiKey ?? process.env.ANTHROPIC_API_KEY;
    this.client = this.enabled && key ? new Anthropic({ apiKey: key }) : null;
  }

  async isFlagged(sentence: string): Promise<boolean> {
    if (!this.enabled || !this.client || !sentence.trim()) return false;
    try {
      const res = await this.client.messages.create({
        model: this.model,
        max_tokens: 5,
        system: SYSTEM_PROMPT,
        messages: [{ role: 'user', content: sentence }],
      });
      const text = res.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim()
        .toUpperCase();
      return text.startsWith('YES');
    } catch (err) {
      // Fail open: a broken moderator shouldn't break the stream.
      console.warn('[output-moderator] error (failing open):', err);
      return false;
    }
  }
}

/**
 * Short, generic in-character pivots injected in place of a skipped
 * sentence so TTS keeps flowing. Works for most personas — the
 * streamer's actual voice colours the delivery. Cheap and static on
 * purpose (no extra Claude call).
 */
const PIVOTS = [
  'anyway—',
  'you know what, forget it.',
  "let's move on.",
  'wait, lost my thread.',
  'actually never mind.',
  'nope, changing the subject.',
];

export function pickPivot(): string {
  const idx = Math.floor(Math.random() * PIVOTS.length);
  return PIVOTS[idx]!;
}
