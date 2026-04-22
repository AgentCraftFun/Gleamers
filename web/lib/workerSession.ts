'use client';

import { useEffect, useRef, useState } from 'react';
import type {
  WorkerFrame,
  WorkerExpression,
  WorkerAudioFormat,
} from '@gleamers/shared';

import type { AvatarExpression } from '@/components/vrm/VRMAvatar';

export type ConnectionStatus =
  | 'idle'
  | 'connecting'
  | 'open'
  | 'closed'
  | 'error';

export interface SessionSubtitle {
  id: string;
  content: string;
  receivedAt: number;
}

export interface UseWorkerSessionState {
  status: ConnectionStatus;
  hello: Extract<WorkerFrame, { type: 'hello' }> | null;
  secondsRemaining: number | null;
  subtitles: SessionSubtitle[];
  expression: AvatarExpression;
  sessionEnded: null | Extract<WorkerFrame, { type: 'session_ending' }>;
  audioElement: HTMLAudioElement | null;
  unlockAudio: () => Promise<void>;
  audioUnlocked: boolean;
  noticedMessageIds: Set<string>;
  addressedSuperChatIds: Set<string>;
}

interface Options {
  wsUrl: string | null;
  enabled?: boolean;
  /** Keep a rolling window of subtitles. */
  maxSubtitles?: number;
}

const EXPRESSION_MAP: Record<WorkerExpression, AvatarExpression> = {
  happy: 'happy',
  angry: 'angry',
  surprised: 'surprised',
  thinking: 'thinking',
  laughing: 'laughing',
  neutral: 'neutral',
};

function b64ToUint8(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

/**
 * Collects PCM chunks into `AudioBuffer`s and schedules them on the
 * shared AudioContext so playback is seamless. Each response_start
 * flushes any half-buffered tail and resets a scheduling cursor.
 */
class AudioPipeline {
  private ctx: AudioContext;
  private destination: MediaStreamAudioDestinationNode;
  private mediaEl: HTMLAudioElement;
  private nextStart = 0;
  private format: WorkerAudioFormat;
  private mimicElement = true;

  constructor(format: WorkerAudioFormat) {
    this.format = format;
    const AC: typeof AudioContext =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext: typeof AudioContext })
        .webkitAudioContext;
    this.ctx = new AC({ sampleRate: format.sampleRate });
    this.destination = this.ctx.createMediaStreamDestination();
    this.mediaEl = new Audio();
    this.mediaEl.autoplay = true;
    this.mediaEl.srcObject = this.destination.stream;
  }

  get element(): HTMLAudioElement {
    return this.mediaEl;
  }

  async unlock(): Promise<void> {
    if (this.ctx.state === 'suspended') {
      await this.ctx.resume();
    }
    if (this.mimicElement) {
      try {
        await this.mediaEl.play();
      } catch {
        /* user-gesture required — retry later */
      }
    }
  }

  resetResponse(): void {
    this.nextStart = Math.max(this.ctx.currentTime, this.nextStart);
  }

  push(pcm: Uint8Array): void {
    if (pcm.length < 2) return;
    // pcm_s16le → Float32 [-1, 1]
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength);
    const frames = Math.floor(pcm.byteLength / 2);
    const floats = new Float32Array(frames);
    for (let i = 0; i < frames; i++) {
      floats[i] = view.getInt16(i * 2, true) / 0x8000;
    }
    const buf = this.ctx.createBuffer(1, frames, this.format.sampleRate);
    buf.copyToChannel(floats, 0);
    const src = this.ctx.createBufferSource();
    src.buffer = buf;
    src.connect(this.destination);
    src.connect(this.ctx.destination);
    const when = Math.max(this.ctx.currentTime, this.nextStart);
    src.start(when);
    this.nextStart = when + buf.duration;
  }

  async dispose(): Promise<void> {
    try {
      this.mediaEl.pause();
      this.mediaEl.srcObject = null;
    } catch {
      /* noop */
    }
    try {
      await this.ctx.close();
    } catch {
      /* noop */
    }
  }
}

export function useWorkerSession(options: Options): UseWorkerSessionState {
  const { wsUrl, enabled = true, maxSubtitles = 6 } = options;

  const [status, setStatus] = useState<ConnectionStatus>('idle');
  const [hello, setHello] = useState<UseWorkerSessionState['hello']>(null);
  const [secondsRemaining, setSecondsRemaining] = useState<number | null>(
    null,
  );
  const [subtitles, setSubtitles] = useState<SessionSubtitle[]>([]);
  const [expression, setExpression] = useState<AvatarExpression>('neutral');
  const [sessionEnded, setSessionEnded] =
    useState<UseWorkerSessionState['sessionEnded']>(null);
  const [audioElement, setAudioElement] = useState<HTMLAudioElement | null>(
    null,
  );
  const [audioUnlocked, setAudioUnlocked] = useState(false);
  const [noticedMessageIds, setNoticedMessageIds] = useState<Set<string>>(
    () => new Set(),
  );
  const [addressedSuperChatIds, setAddressedSuperChatIds] = useState<
    Set<string>
  >(() => new Set());

  const wsRef = useRef<WebSocket | null>(null);
  const pipeRef = useRef<AudioPipeline | null>(null);
  const expressionResetRef = useRef<number | null>(null);
  const reconnectTimerRef = useRef<number | null>(null);
  const attemptRef = useRef(0);

  useEffect(() => {
    if (!enabled || !wsUrl) return;

    let cancelled = false;
    const MAX_ATTEMPTS = 5;
    const scheduleReconnect = () => {
      if (cancelled) return;
      if (attemptRef.current >= MAX_ATTEMPTS) {
        setStatus('error');
        return;
      }
      // Exponential backoff: 1s, 2s, 4s, 8s, 16s.
      const delayMs = Math.min(16_000, 2 ** attemptRef.current * 1000);
      attemptRef.current += 1;
      reconnectTimerRef.current = window.setTimeout(connect, delayMs);
    };

    const connect = () => {
      if (cancelled) return;
      setStatus('connecting');
      const ws = new WebSocket(wsUrl);
      wsRef.current = ws;

      ws.addEventListener('open', () => {
        if (cancelled) return;
        attemptRef.current = 0;
        setStatus('open');
      });
      ws.addEventListener('error', () => {
        if (cancelled) return;
        setStatus('error');
      });
      ws.addEventListener('close', () => {
        if (cancelled) return;
        if (sessionEnded) {
          setStatus('closed');
          return;
        }
        setStatus((s) => (s === 'error' ? 'error' : 'closed'));
        scheduleReconnect();
      });

      ws.addEventListener('message', (ev) => {
      if (cancelled) return;
      let frame: WorkerFrame;
      try {
        frame = JSON.parse(String(ev.data));
      } catch {
        return;
      }
      switch (frame.type) {
        case 'hello': {
          setHello(frame);
          const pipe = new AudioPipeline(frame.audioFormat);
          pipeRef.current = pipe;
          setAudioElement(pipe.element);
          setSecondsRemaining(
            Math.max(
              0,
              Math.floor(
                (new Date(frame.endsAt).getTime() - Date.now()) / 1000,
              ),
            ),
          );
          break;
        }
        case 'response_start':
          pipeRef.current?.resetResponse();
          break;
        case 'audio_chunk': {
          const bytes = b64ToUint8(frame.data);
          pipeRef.current?.push(bytes);
          break;
        }
        case 'response_end':
          break;
        case 'text':
          setSubtitles((prev) => {
            const next = [
              ...prev,
              {
                id: `${frame.responseId}:${frame.sentenceIndex}`,
                content: frame.content,
                receivedAt: frame.timestamp,
              },
            ];
            return next.slice(-maxSubtitles);
          });
          break;
        case 'expression': {
          const mapped = EXPRESSION_MAP[frame.expression] ?? 'neutral';
          setExpression(mapped);
          if (expressionResetRef.current)
            window.clearTimeout(expressionResetRef.current);
          expressionResetRef.current = window.setTimeout(() => {
            setExpression('neutral');
          }, 2500);
          break;
        }
        case 'session_info':
          setSecondsRemaining(frame.secondsRemaining);
          break;
        case 'session_ending':
          setSessionEnded(frame);
          break;
        case 'message_noticed':
          setNoticedMessageIds((prev) => {
            if (prev.has(frame.messageId)) return prev;
            const next = new Set(prev);
            next.add(frame.messageId);
            return next;
          });
          break;
        case 'super_chat_addressed':
          setAddressedSuperChatIds((prev) => {
            if (prev.has(frame.messageId)) return prev;
            const next = new Set(prev);
            next.add(frame.messageId);
            return next;
          });
          break;
      }
      });
    };

    connect();

    return () => {
      cancelled = true;
      if (reconnectTimerRef.current) {
        window.clearTimeout(reconnectTimerRef.current);
        reconnectTimerRef.current = null;
      }
      try {
        wsRef.current?.close();
      } catch {
        /* noop */
      }
      if (expressionResetRef.current) {
        window.clearTimeout(expressionResetRef.current);
      }
      pipeRef.current?.dispose();
      pipeRef.current = null;
      setAudioElement(null);
      attemptRef.current = 0;
    };
  }, [wsUrl, enabled, maxSubtitles, sessionEnded]);

  // Countdown tick (every 1s, local — the server also pushes every 10s).
  useEffect(() => {
    if (secondsRemaining === null) return;
    if (secondsRemaining <= 0) return;
    const id = window.setInterval(() => {
      setSecondsRemaining((n) => (n === null ? null : Math.max(0, n - 1)));
    }, 1000);
    return () => window.clearInterval(id);
  }, [secondsRemaining]);

  const unlockAudio = async () => {
    await pipeRef.current?.unlock();
    setAudioUnlocked(true);
  };

  return {
    status,
    hello,
    secondsRemaining,
    subtitles,
    expression,
    sessionEnded,
    audioElement,
    unlockAudio,
    audioUnlocked,
    noticedMessageIds,
    addressedSuperChatIds,
  };
}
