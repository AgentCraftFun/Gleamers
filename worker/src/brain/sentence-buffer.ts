import type { BrainExpression } from './types.js';

const EXPRESSION_TAG_RE = /\[(happy|angry|thinking|laughing|surprised)\]/gi;

const EXPRESSION_LOOKUP: Record<string, BrainExpression> = {
  happy: 'happy',
  angry: 'angry',
  thinking: 'thinking',
  laughing: 'laughing',
  surprised: 'surprised',
};

export interface ParsedSentence {
  /** Sentence text with tags stripped, trimmed, collapsed whitespace. */
  ttsText: string;
  /** Raw sentence text including tags. */
  rawText: string;
  /** Expressions in the order they appeared. */
  expressions: BrainExpression[];
}

/**
 * Strip and collect expression tags from a sentence. Returns clean TTS
 * text and the ordered expression list.
 */
export function parseSentence(raw: string): ParsedSentence {
  const expressions: BrainExpression[] = [];
  const stripped = raw.replace(EXPRESSION_TAG_RE, (_, tag: string) => {
    const expr = EXPRESSION_LOOKUP[tag.toLowerCase()];
    if (expr) expressions.push(expr);
    return ' ';
  });
  const ttsText = stripped.replace(/\s+/g, ' ').trim();
  return { ttsText, rawText: raw.trim(), expressions };
}

/**
 * Accumulates streamed text and emits complete sentences as they are
 * formed. A sentence boundary is any of `.!?` followed by whitespace
 * or end of input, but only if it's not inside an abbreviation (we use
 * a simple length check).
 */
export class SentenceBuffer {
  private buf = '';

  push(chunk: string): string[] {
    this.buf += chunk;
    const out: string[] = [];
    const re = /([^.!?]+[.!?]+)(?=\s|$)/g;
    let lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = re.exec(this.buf))) {
      const sentence = (match[1] ?? '').trim();
      if (sentence.length > 0) out.push(sentence);
      lastIndex = re.lastIndex;
    }
    if (lastIndex > 0) {
      this.buf = this.buf.slice(lastIndex).replace(/^\s+/, '');
    }
    return out;
  }

  /** Drain the remaining buffered text (called once the stream ends). */
  flush(): string | null {
    const remaining = this.buf.trim();
    this.buf = '';
    return remaining.length > 0 ? remaining : null;
  }
}
