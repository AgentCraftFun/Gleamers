/**
 * CLI smoke test for StreamerBrain.
 *
 *   pnpm --filter worker test:brain [slug] [--monologue] [--super N]
 *
 * Defaults:
 *   slug    = mika
 *   mode    = chat_response
 *   message = "what do you think about pigeons?" (from dev)
 *
 * Requires env: SUPABASE_URL, SUPABASE_SERVICE_KEY, ANTHROPIC_API_KEY,
 * and CARTESIA_API_KEY (unless --dry is passed).
 *
 * Writes WAV to test-output.wav in the current directory.
 */
import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';

import { getSupabase } from './supabase.js';
import { StreamerBrain } from './brain/streamer-brain.js';
import { pcmToWav } from './brain/cartesia.js';
import type {
  BrainFrame,
  BrainExpression,
  StreamerMode,
} from './brain/types.js';

interface Args {
  slug: string;
  mode: StreamerMode;
  chatContent: string;
  username: string;
  tier?: 1 | 2 | 3;
  dry: boolean;
  outPath: string;
}

function parseArgs(argv: string[]): Args {
  const positional: string[] = [];
  let mode: StreamerMode = 'chat_response';
  let tier: 1 | 2 | 3 | undefined;
  let dry = false;
  let outPath = 'test-output.wav';
  let chatContent = 'what do you think about pigeons?';
  let username = 'dev';

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (!arg) continue;
    if (arg === '--monologue') mode = 'monologue';
    else if (arg === '--super') {
      mode = 'super_chat_response';
      const next = Number(argv[i + 1]);
      if (next >= 1 && next <= 3) {
        tier = next as 1 | 2 | 3;
        i++;
      } else {
        tier = 1;
      }
    } else if (arg === '--dry') dry = true;
    else if (arg === '--out') {
      outPath = argv[++i] ?? outPath;
    } else if (arg === '--msg') {
      chatContent = argv[++i] ?? chatContent;
    } else if (arg === '--user') {
      username = argv[++i] ?? username;
    } else if (!arg.startsWith('-')) {
      positional.push(arg);
    }
  }

  const slug = positional[0] ?? 'mika';
  return { slug, mode, chatContent, username, tier, dry, outPath };
}

function expressionColor(expr: BrainExpression): string {
  const map: Record<BrainExpression, string> = {
    happy: '\x1b[33m',
    angry: '\x1b[31m',
    surprised: '\x1b[36m',
    thinking: '\x1b[35m',
    laughing: '\x1b[32m',
  };
  return map[expr] ?? '\x1b[0m';
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  console.log('[brain-test] args:', args);

  const sb = getSupabase();
  const { data: streamer, error } = await sb
    .from('streamers')
    .select('id, name, slug, voice_id, personality_config')
    .eq('slug', args.slug)
    .maybeSingle();
  if (error) throw error;
  if (!streamer) {
    console.error(`[brain-test] streamer not found: ${args.slug}`);
    process.exit(1);
  }

  console.log(`[brain-test] loaded: ${streamer.name} (voice=${streamer.voice_id})`);

  const { data: lore } = await sb
    .from('streamer_lore')
    .select('*')
    .eq('streamer_id', streamer.id)
    .order('relevance_score', { ascending: false })
    .limit(20);

  const brain = new StreamerBrain({
    personalityConfig: streamer.personality_config,
    voiceId: streamer.voice_id,
    skipTts: args.dry,
  });

  const pcm: Uint8Array[] = [];
  const expressionLog: Array<{ atIndex: number; expression: BrainExpression }> =
    [];
  let textOut = '';

  const chatTrigger =
    args.mode === 'monologue'
      ? undefined
      : {
          content: args.chatContent,
          username: args.username,
          tier: args.tier,
        };

  console.log(`[brain-test] generating (mode=${args.mode})...`);

  const frames = brain.generate({
    mode: args.mode,
    chatTrigger,
    lore: lore ?? [],
  });

  for await (const frame of frames as AsyncGenerator<BrainFrame>) {
    switch (frame.type) {
      case 'text_chunk':
        process.stdout.write(frame.text);
        textOut += frame.text;
        break;
      case 'expression': {
        const col = expressionColor(frame.expression);
        process.stdout.write(`${col}[${frame.expression}]\x1b[0m`);
        expressionLog.push({
          atIndex: frame.atIndex,
          expression: frame.expression,
        });
        break;
      }
      case 'sentence':
        // sentence boundary — newline for readable logs
        process.stdout.write('\n');
        break;
      case 'audio_chunk':
        pcm.push(frame.audio);
        break;
      case 'done':
        console.log('\n[brain-test] done.');
        break;
    }
  }

  console.log('\n--- transcript ---');
  console.log(textOut.trim());
  console.log('--- expressions ---');
  for (const e of expressionLog) {
    console.log(`  sentence[${e.atIndex}] -> ${e.expression}`);
  }

  if (args.dry) {
    console.log('[brain-test] --dry set, skipping audio write.');
    return;
  }

  if (pcm.length === 0) {
    console.warn('[brain-test] no audio received — nothing to write.');
    return;
  }

  const wav = pcmToWav(pcm, {
    sampleRate: 24000,
    encoding: 'pcm_s16le',
    channels: 1,
  });
  const outAbs = resolve(args.outPath);
  await writeFile(outAbs, wav);
  const bytes = pcm.reduce((n, c) => n + c.length, 0);
  console.log(
    `[brain-test] wrote ${wav.length} bytes (${bytes} PCM, ~${(bytes / (24000 * 2)).toFixed(2)}s) -> ${outAbs}`,
  );
}

main().catch((err) => {
  console.error('[brain-test] failed:', err);
  process.exit(1);
});
