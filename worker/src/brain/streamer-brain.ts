import Anthropic from '@anthropic-ai/sdk';
import type { PersonalityConfig } from '@gleamers/shared';

import { compilePrompt } from './personality-compiler.js';
import { streamCartesia } from './cartesia.js';
import { SentenceBuffer, parseSentence } from './sentence-buffer.js';
import { OutputModerator, pickPivot } from './output-moderator.js';
import type { BrainContext, BrainFrame } from './types.js';

const DEFAULT_MODEL = 'claude-haiku-4-5-20251001';

export interface StreamerBrainOptions {
  personalityConfig: PersonalityConfig;
  voiceId: string;
  anthropicApiKey?: string;
  cartesiaApiKey?: string;
  /** Override the model (defaults to claude-haiku-4-5-20251001). */
  model?: string;
  /** Override Cartesia TTS model (defaults to sonic-english). */
  ttsModelId?: string;
  /** Sample rate for Cartesia output (defaults to 24000). */
  sampleRate?: number;
  /** Max tokens per Claude response. */
  maxTokens?: number;
  /** Skip TTS entirely (useful for dry runs). */
  skipTts?: boolean;
  /** Inject an already-built moderator, or pass false to disable. */
  outputModerator?: OutputModerator | false;
  /** Consecutive flagged sentences that abort the response. Default 3. */
  maxFlaggedPerResponse?: number;
}

const DEFAULT_MAX_FLAGGED = 3;

const USER_PROMPT_BY_MODE = {
  monologue: 'Go.',
  chat_response: 'React now.',
  super_chat_response: 'React now.',
} as const;

const MAX_TOKENS_BY_MODE = {
  chat_response: 240,
  monologue: 480,
  super_chat_response: 600,
} as const;

/**
 * StreamerBrain
 *
 * Streams a Claude response, splits it into sentences, parses inline
 * expression tags, strips them for TTS, and pipes each sentence
 * through Cartesia in parallel with the next one generating. Yields
 * BrainFrames the caller can fan out to websockets, database, or a
 * test-harness audio sink.
 */
export class StreamerBrain {
  private readonly personality: PersonalityConfig;
  private readonly voiceId: string;
  private readonly model: string;
  private readonly ttsModelId: string;
  private readonly sampleRate: number;
  private readonly maxTokensOverride?: number;
  private readonly skipTts: boolean;
  private readonly anthropic: Anthropic;
  private readonly cartesiaApiKey: string | undefined;
  private readonly moderator: OutputModerator | null;
  private readonly maxFlagged: number;

  constructor(opts: StreamerBrainOptions) {
    this.personality = opts.personalityConfig;
    this.voiceId = opts.voiceId;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.ttsModelId = opts.ttsModelId ?? 'sonic-english';
    this.sampleRate = opts.sampleRate ?? 24000;
    this.maxTokensOverride = opts.maxTokens;
    this.skipTts = opts.skipTts ?? false;
    this.maxFlagged = opts.maxFlaggedPerResponse ?? DEFAULT_MAX_FLAGGED;

    const anthropicKey =
      opts.anthropicApiKey ?? process.env.ANTHROPIC_API_KEY;
    if (!anthropicKey) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }
    this.anthropic = new Anthropic({ apiKey: anthropicKey });

    this.cartesiaApiKey = opts.cartesiaApiKey ?? process.env.CARTESIA_API_KEY;
    if (!this.skipTts && !this.cartesiaApiKey) {
      throw new Error('Missing CARTESIA_API_KEY (or pass skipTts=true)');
    }

    if (opts.outputModerator === false) {
      this.moderator = null;
    } else if (opts.outputModerator instanceof OutputModerator) {
      this.moderator = opts.outputModerator;
    } else {
      this.moderator = new OutputModerator({ apiKey: anthropicKey });
    }
  }

  async *generate(ctx: BrainContext): AsyncGenerator<BrainFrame, void, void> {
    const system = compilePrompt({
      config: this.personality,
      mode: ctx.mode,
      chatTrigger: ctx.chatTrigger,
      recentContext: ctx.recentContext,
      lore: ctx.lore,
    });

    const stream = this.anthropic.messages.stream({
      model: this.model,
      max_tokens: this.maxTokensOverride ?? MAX_TOKENS_BY_MODE[ctx.mode],
      system,
      messages: [{ role: 'user', content: USER_PROMPT_BY_MODE[ctx.mode] }],
    });

    const buffer = new SentenceBuffer();
    let full = '';
    let sentenceIndex = 0;
    let flaggedCount = 0;
    let aborted = false;

    const processSentence = async function* (
      this: StreamerBrain,
      raw: string,
    ): AsyncGenerator<BrainFrame, boolean, void> {
      const idx = sentenceIndex++;
      const result = yield* this.emitSentence(raw, idx);
      if (result === 'flagged') {
        flaggedCount += 1;
        if (flaggedCount >= this.maxFlagged) {
          yield {
            type: 'moderation_event',
            kind: 'output_regenerated',
            sentenceIndex: idx,
            rawText: raw,
          };
          return true; // signal abort
        }
      }
      return false;
    }.bind(this);

    for await (const event of stream) {
      if (aborted) break;
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const chunk = event.delta.text;
        full += chunk;
        yield { type: 'text_chunk', text: chunk };

        const ready = buffer.push(chunk);
        for (const sentence of ready) {
          const abort = yield* processSentence(sentence);
          if (abort) {
            aborted = true;
            break;
          }
        }
      }
    }

    if (!aborted) {
      const tail = buffer.flush();
      if (tail) {
        yield* processSentence(tail);
      }
    }

    yield { type: 'done', fullText: full };
  }

  /**
   * Emit a single sentence. Runs output moderation before TTS; when
   * the moderator flags the sentence we emit a `moderation_event` and
   * substitute a static in-character pivot so playback stays fluid.
   * Yields a generator that returns either 'ok' or 'flagged' so the
   * outer loop can count + abort.
   */
  private async *emitSentence(
    rawSentence: string,
    sentenceIndex: number,
  ): AsyncGenerator<BrainFrame, 'ok' | 'flagged', void> {
    const parsed = parseSentence(rawSentence);
    if (parsed.ttsText.length === 0) {
      return 'ok';
    }

    if (this.moderator) {
      let flagged = false;
      try {
        flagged = await this.moderator.isFlagged(parsed.ttsText);
      } catch (err) {
        // Fail open — a broken moderator shouldn't stop the stream.
        console.warn('[streamer-brain] moderator threw:', err);
      }
      if (flagged) {
        yield {
          type: 'moderation_event',
          kind: 'output_blocked',
          sentenceIndex,
          rawText: rawSentence,
        };
        // Substitute a pivot so the TTS timeline has something to say.
        const pivot = pickPivot();
        yield {
          type: 'sentence',
          text: pivot,
          sentenceIndex,
        };
        if (!this.skipTts && this.cartesiaApiKey) {
          for await (const audio of streamCartesia({
            apiKey: this.cartesiaApiKey,
            voiceId: this.voiceId,
            text: pivot,
            modelId: this.ttsModelId,
            sampleRate: this.sampleRate,
          })) {
            yield { type: 'audio_chunk', audio, sentenceIndex };
          }
        }
        return 'flagged';
      }
    }

    for (const expression of parsed.expressions) {
      yield { type: 'expression', expression, atIndex: sentenceIndex };
    }
    yield {
      type: 'sentence',
      text: parsed.ttsText,
      sentenceIndex,
    };

    if (this.skipTts || !this.cartesiaApiKey) {
      return 'ok';
    }

    for await (const audio of streamCartesia({
      apiKey: this.cartesiaApiKey,
      voiceId: this.voiceId,
      text: parsed.ttsText,
      modelId: this.ttsModelId,
      sampleRate: this.sampleRate,
    })) {
      yield { type: 'audio_chunk', audio, sentenceIndex };
    }
    return 'ok';
  }
}
