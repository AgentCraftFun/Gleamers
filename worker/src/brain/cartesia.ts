/**
 * Minimal Cartesia HTTP streaming TTS client.
 *
 * Uses POST /tts/bytes which streams raw audio bytes back as chunks.
 * Requesting `pcm_s16le` at 24kHz keeps chunks small and gives us a
 * simple path to concatenate into a WAV later.
 */
const CARTESIA_VERSION = '2024-11-13';

export interface CartesiaStreamOptions {
  apiKey: string;
  voiceId: string;
  text: string;
  modelId?: string;
  sampleRate?: number;
  language?: string;
  signal?: AbortSignal;
}

export interface CartesiaAudioFormat {
  sampleRate: number;
  encoding: 'pcm_s16le';
  channels: 1;
}

export async function* streamCartesia(
  opts: CartesiaStreamOptions,
): AsyncGenerator<Uint8Array, void, void> {
  const sampleRate = opts.sampleRate ?? 24000;
  const res = await fetch('https://api.cartesia.ai/tts/bytes', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-API-Key': opts.apiKey,
      'Cartesia-Version': CARTESIA_VERSION,
    },
    body: JSON.stringify({
      model_id: opts.modelId ?? 'sonic-english',
      transcript: opts.text,
      voice: { mode: 'id', id: opts.voiceId },
      output_format: {
        container: 'raw',
        encoding: 'pcm_s16le',
        sample_rate: sampleRate,
      },
      language: opts.language ?? 'en',
    }),
    signal: opts.signal,
  });

  if (!res.ok || !res.body) {
    const body = await res.text().catch(() => '');
    throw new Error(
      `Cartesia TTS failed: ${res.status} ${res.statusText} ${body}`,
    );
  }

  const reader = res.body.getReader();
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      if (value && value.length > 0) yield value;
    }
  } finally {
    reader.releaseLock();
  }
}

/**
 * Build a WAV file (RIFF header + PCM data) from one or more PCM
 * chunks at the given sample rate. Mono, s16le.
 */
export function pcmToWav(
  chunks: Uint8Array[],
  format: CartesiaAudioFormat,
): Uint8Array {
  const dataSize = chunks.reduce((n, c) => n + c.length, 0);
  const header = Buffer.alloc(44);
  const byteRate = format.sampleRate * format.channels * 2;
  header.write('RIFF', 0);
  header.writeUInt32LE(36 + dataSize, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(format.channels, 22);
  header.writeUInt32LE(format.sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(format.channels * 2, 32);
  header.writeUInt16LE(16, 34);
  header.write('data', 36);
  header.writeUInt32LE(dataSize, 40);

  const out = new Uint8Array(44 + dataSize);
  out.set(header, 0);
  let offset = 44;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.length;
  }
  return out;
}
