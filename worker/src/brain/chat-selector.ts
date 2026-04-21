/**
 * ChatSelector
 *
 * Holds pending chat messages for an active streamer session, scores
 * them by relevance, decays scores over time, and picks the most
 * relevant next message when the streamer loop asks for input.
 *
 * Score components (per spec):
 *   recency         starts at 1.0; decays 0.96/s
 *   tokenWeight     TOKEN_LIVE ? min(log10(1 + balance/threshold), 2) : 0
 *   streamerBonus   +0.5 if content contains streamer.name (case-insensitive)
 *   questionBonus   +0.3 if content contains '?'
 *   spamPenalty     -0.5 if content is ALL-CAPS and length > 10
 *   duplicatePenalty -0.5 if fuzzy match against last 20 noticed
 *   jitter          uniform(-0.2, 0.2)
 *   total           = clamp(sum, 0, 5)
 *
 * Decay tick: every 1s, multiply all pending scores by 0.96; drop
 * entries below 0.1.
 */

const DECAY_INTERVAL_MS = 1000;
const DECAY_MULTIPLIER = 0.96;
const DROP_THRESHOLD = 0.1;
const NOTICED_HISTORY_SIZE = 20;
const DUPLICATE_JACCARD_THRESHOLD = 0.6;

export interface IncomingChat {
  messageId: string;
  userId: string;
  displayName: string;
  content: string;
  /** bigint-like string. Raw ERC-20 base units. */
  tokenBalance: string;
  createdAt: string;
}

interface PendingMessage extends IncomingChat {
  score: number;
}

export interface ChatSelectorOptions {
  streamerName: string;
  tokenLive: boolean;
  /** Baseline token balance for log10 scaling. Defaults to 1e18 (1 token @ 18 decimals). */
  tokenThreshold?: bigint;
}

function tokenize(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(Boolean),
  );
}

function jaccard(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 && b.size === 0) return 1;
  let inter = 0;
  for (const t of a) if (b.has(t)) inter++;
  const union = a.size + b.size - inter;
  return union === 0 ? 0 : inter / union;
}

export class ChatSelector {
  private pending = new Map<string, PendingMessage>();
  private noticedTokens: Array<Set<string>> = [];
  private decayTimer: NodeJS.Timeout | null = null;
  private lastChatSeenAt = 0;

  constructor(private readonly opts: ChatSelectorOptions) {}

  /** Start the once-per-second decay loop. */
  start(): void {
    if (this.decayTimer) return;
    this.decayTimer = setInterval(() => this.decayTick(), DECAY_INTERVAL_MS);
  }

  stop(): void {
    if (this.decayTimer) {
      clearInterval(this.decayTimer);
      this.decayTimer = null;
    }
  }

  /** Lightweight public accessor for the stream loop. */
  get size(): number {
    return this.pending.size;
  }

  get msSinceLastChat(): number {
    return this.lastChatSeenAt === 0 ? Infinity : Date.now() - this.lastChatSeenAt;
  }

  /** Drop a chat message into the scorer. Overwrites on duplicate ID. */
  add(msg: IncomingChat): void {
    this.lastChatSeenAt = Date.now();
    const score = this.scoreFor(msg);
    this.pending.set(msg.messageId, { ...msg, score });
  }

  /** Pick the highest-scoring pending message, mark it noticed. */
  pickNext(): IncomingChat | null {
    let best: PendingMessage | null = null;
    for (const msg of this.pending.values()) {
      if (!best || msg.score > best.score) best = msg;
    }
    if (!best) return null;
    this.pending.delete(best.messageId);
    this.noticedTokens.push(tokenize(best.content));
    if (this.noticedTokens.length > NOTICED_HISTORY_SIZE) {
      this.noticedTokens.shift();
    }
    return {
      messageId: best.messageId,
      userId: best.userId,
      displayName: best.displayName,
      content: best.content,
      tokenBalance: best.tokenBalance,
      createdAt: best.createdAt,
    };
  }

  /** For diagnostics / tests. */
  peekAll(): PendingMessage[] {
    return [...this.pending.values()].sort((a, b) => b.score - a.score);
  }

  // --- internals --------------------------------------------------------

  private decayTick(): void {
    for (const [id, msg] of this.pending) {
      msg.score *= DECAY_MULTIPLIER;
      if (msg.score < DROP_THRESHOLD) this.pending.delete(id);
    }
  }

  private scoreFor(msg: IncomingChat): number {
    let score = 1.0; // recency, starts at 1

    // Token weight
    if (this.opts.tokenLive) {
      try {
        const raw = BigInt(msg.tokenBalance || '0');
        const threshold = this.opts.tokenThreshold ?? BigInt('1000000000000000000'); // 1e18
        // log10(1 + balance/threshold). Compute in float space after dividing.
        const ratio = threshold === 0n ? 0 : Number(raw) / Number(threshold);
        const weight = Math.min(Math.log10(1 + Math.max(0, ratio)), 2.0);
        score += Number.isFinite(weight) ? weight : 0;
      } catch {
        /* ignore malformed balance */
      }
    }

    // Streamer name mention
    const lowerName = this.opts.streamerName.toLowerCase();
    const lowerContent = msg.content.toLowerCase();
    if (lowerName.length > 0 && lowerContent.includes(lowerName)) {
      score += 0.5;
    }

    // Question bonus
    if (msg.content.includes('?')) score += 0.3;

    // Spam penalty: ALL-CAPS length > 10 (excluding spaces/punctuation)
    const letters = msg.content.replace(/[^\p{L}]/gu, '');
    if (letters.length > 10 && letters === letters.toUpperCase()) {
      score -= 0.5;
    }

    // Fuzzy duplicate penalty against last noticed
    const currentTokens = tokenize(msg.content);
    for (const past of this.noticedTokens) {
      if (jaccard(past, currentTokens) >= DUPLICATE_JACCARD_THRESHOLD) {
        score -= 0.5;
        break;
      }
    }

    // Jitter
    score += Math.random() * 0.4 - 0.2;

    return Math.max(0, Math.min(5, score));
  }
}
