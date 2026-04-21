import type { PersonalityConfig, StreamerLoreRow } from '@gleamers/shared';

export type StreamerMode =
  | 'monologue'
  | 'chat_response'
  | 'super_chat_response';

export type BrainExpression =
  | 'happy'
  | 'angry'
  | 'surprised'
  | 'thinking'
  | 'laughing';

export interface ChatTrigger {
  content: string;
  username: string;
  tier?: 1 | 2 | 3;
}

export interface BrainContext {
  mode: StreamerMode;
  chatTrigger?: ChatTrigger;
  recentContext?: string;
  lore?: StreamerLoreRow[];
}

export type BrainFrame =
  | { type: 'text_chunk'; text: string }
  | { type: 'expression'; expression: BrainExpression; atIndex: number }
  | { type: 'audio_chunk'; audio: Uint8Array; sentenceIndex: number }
  | { type: 'sentence'; text: string; sentenceIndex: number }
  | {
      type: 'moderation_event';
      kind: 'output_blocked' | 'output_regenerated';
      sentenceIndex: number;
      rawText: string;
    }
  | { type: 'done'; fullText: string };

export interface CompilePromptInput {
  config: PersonalityConfig;
  mode: StreamerMode;
  chatTrigger?: ChatTrigger;
  recentContext?: string;
  lore?: StreamerLoreRow[];
}
