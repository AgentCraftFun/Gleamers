import Anthropic from '@anthropic-ai/sdk';

/**
 * Rolling in-session context. Stores up to `maxItems` recent exchanges
 * and once the total text approaches a token budget, collapses the
 * older half into a Haiku summary so the live tail stays fresh.
 *
 * Token counts are approximated at ~4 chars/token — good enough for
 * budget decisions, not for billing.
 */

const APPROX_CHARS_PER_TOKEN = 4;
const DEFAULT_MAX_ITEMS = 20;
const DEFAULT_TOKEN_BUDGET = 6000; // trigger summarisation below 8k
const SUMMARY_MODEL = 'claude-haiku-4-5-20251001';

export type ExchangeRole = 'user' | 'ai';

export interface ExchangeEntry {
  role: ExchangeRole;
  text: string;
  username?: string;
  tier?: 1 | 2 | 3;
  timestamp: number;
}

export interface ExchangeHistoryOptions {
  maxItems?: number;
  tokenBudget?: number;
  anthropicApiKey?: string;
  summaryModel?: string;
  /** Pass false to disable the Haiku summariser entirely (fail-open). */
  enableSummarizer?: boolean;
}

export class ExchangeHistory {
  private items: ExchangeEntry[] = [];
  private summary: string | null = null;
  private readonly maxItems: number;
  private readonly tokenBudget: number;
  private readonly summaryModel: string;
  private readonly client: Anthropic | null;

  constructor(opts: ExchangeHistoryOptions = {}) {
    this.maxItems = opts.maxItems ?? DEFAULT_MAX_ITEMS;
    this.tokenBudget = opts.tokenBudget ?? DEFAULT_TOKEN_BUDGET;
    this.summaryModel = opts.summaryModel ?? SUMMARY_MODEL;

    const key = opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    this.client = opts.enableSummarizer === false || !key
      ? null
      : new Anthropic({ apiKey: key });
  }

  push(entry: ExchangeEntry): void {
    this.items.push(entry);
    while (this.items.length > this.maxItems) {
      this.items.shift();
    }
  }

  get size(): number {
    return this.items.length;
  }

  get currentSummary(): string | null {
    return this.summary;
  }

  /** Approximate total tokens of the live tail + summary. */
  get approximateTokens(): number {
    const chars =
      (this.summary?.length ?? 0) +
      this.items.reduce((n, e) => n + e.text.length + (e.username?.length ?? 0), 0);
    return Math.ceil(chars / APPROX_CHARS_PER_TOKEN);
  }

  /**
   * Render the current context as a chunk suitable for
   * personality-compiler's recentContext slot.
   */
  asRecentContext(): string {
    const lines: string[] = [];
    if (this.summary) {
      lines.push(`Earlier in this session:\n${this.summary}`);
    }
    for (const e of this.items) {
      if (e.role === 'user') {
        const tierTag = e.tier ? ` (super-chat T${e.tier})` : '';
        const name = e.username ?? 'chatter';
        lines.push(`${name}${tierTag}: ${e.text}`);
      } else {
        lines.push(`You: ${e.text}`);
      }
    }
    return lines.join('\n');
  }

  /**
   * If the current context is over budget and we have a Haiku client,
   * summarise the older half into `summary` and trim. No-op otherwise.
   */
  async maybeSummarize(): Promise<boolean> {
    if (!this.client) return false;
    if (this.approximateTokens < this.tokenBudget) return false;
    if (this.items.length < 6) return false;

    const half = Math.floor(this.items.length / 2);
    const older = this.items.slice(0, half);
    const text = older
      .map((e) =>
        e.role === 'user'
          ? `${e.username ?? 'chatter'}: ${e.text}`
          : `You: ${e.text}`,
      )
      .join('\n');

    const prelude = this.summary ? `Previous summary:\n${this.summary}\n\n` : '';
    try {
      const res = await this.client.messages.create({
        model: this.summaryModel,
        max_tokens: 200,
        system:
          'Summarise the conversation tail in 3-4 sentences. Keep the streamer\'s voice.',
        messages: [{ role: 'user', content: `${prelude}New exchanges:\n${text}` }],
      });
      const newSummary = res.content
        .filter((b): b is { type: 'text'; text: string } => b.type === 'text')
        .map((b) => b.text)
        .join(' ')
        .trim();
      if (!newSummary) return false;
      this.summary = newSummary;
      this.items = this.items.slice(half);
      return true;
    } catch (err) {
      console.warn('[exchange-history] summarise failed:', err);
      return false;
    }
  }

  /** Expose a plain snapshot, mainly for transcript assembly / tests. */
  snapshot(): ExchangeEntry[] {
    return [...this.items];
  }
}
