import Anthropic from '@anthropic-ai/sdk';
import type { PersonalityConfig } from '@gleamers/shared';

import { compilePrompt } from './personality-compiler.js';
import { streamCartesia } from './cartesia.js';
import { SentenceBuffer, parseSentence } from './sentence-buffer.js';
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
}

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

  constructor(opts: StreamerBrainOptions) {
    this.personality = opts.personalityConfig;
    this.voiceId = opts.voiceId;
    this.model = opts.model ?? DEFAULT_MODEL;
    this.ttsModelId = opts.ttsModelId ?? 'sonic-english';
    this.sampleRate = opts.sampleRate ?? 24000;
    this.maxTokensOverride = opts.maxTokens;
    this.skipTts = opts.skipTts ?? false;

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

    for await (const event of stream) {
      if (
        event.type === 'content_block_delta' &&
        event.delta.type === 'text_delta'
      ) {
        const chunk = event.delta.text;
        full += chunk;
        yield { type: 'text_chunk', text: chunk };

        const ready = buffer.push(chunk);
        for (const sentence of ready) {
          yield* this.emitSentence(sentence, sentenceIndex++);
        }
      }
    }

    const tail = buffer.flush();
    if (tail) {
      yield* this.emitSentence(tail, sentenceIndex++);
    }

    yield { type: 'done', fullText: full };
  }

  private async *emitSentence(
    rawSentence: string,
    sentenceIndex: number,
  ): AsyncGenerator<BrainFrame, void, void> {
    const parsed = parseSentence(rawSentence);

    for (const expression of parsed.expressions) {
      yield { type: 'expression', expression, atIndex: sentenceIndex };
    }
    yield {
      type: 'sentence',
      text: parsed.ttsText,
      sentenceIndex,
    };

    if (this.skipTts || parsed.ttsText.length === 0 || !this.cartesiaApiKey) {
      return;
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
  }
}
