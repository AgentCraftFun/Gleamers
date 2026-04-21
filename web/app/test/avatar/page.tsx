'use client';

import { useEffect, useRef, useState } from 'react';
import { VRMAvatar, type AvatarExpression } from '@/components/vrm/VRMAvatar';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

const EXPRESSIONS: AvatarExpression[] = [
  'neutral',
  'happy',
  'angry',
  'surprised',
  'thinking',
  'laughing',
];

export default function AvatarTestPage() {
  const [vrmUrl, setVrmUrl] = useState<string>('/demo.vrm');
  const [audioUrl, setAudioUrl] = useState<string | null>(null);
  const [expression, setExpression] = useState<AvatarExpression>('neutral');
  const [isSleeping, setIsSleeping] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const audioRef = useRef<HTMLAudioElement>(null);

  useEffect(() => {
    return () => {
      if (audioUrl) URL.revokeObjectURL(audioUrl);
    };
  }, [audioUrl]);

  function onAudioFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    if (audioUrl) URL.revokeObjectURL(audioUrl);
    setAudioUrl(URL.createObjectURL(file));
    setIsPlaying(false);
  }

  function onVrmFile(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    setVrmUrl(URL.createObjectURL(file));
  }

  async function togglePlay() {
    const el = audioRef.current;
    if (!el) return;
    if (el.paused) {
      try {
        await el.play();
        setIsPlaying(true);
      } catch (err) {
        console.error(err);
      }
    } else {
      el.pause();
      setIsPlaying(false);
    }
  }

  function setAndHold(expr: AvatarExpression) {
    // Flip through neutral so the queue on the avatar takes it.
    setExpression('neutral');
    requestAnimationFrame(() => setExpression(expr));
  }

  return (
    <main className="min-h-screen bg-background p-6">
      <div className="mx-auto flex max-w-6xl flex-col gap-4">
        <header>
          <h1 className="text-2xl font-semibold">Avatar test harness</h1>
          <p className="text-sm text-muted-foreground">
            Upload a VRM and an MP3 to verify lip-sync, expressions, and
            sleep animation.
          </p>
        </header>

        <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
          <div className="min-h-[480px] overflow-hidden rounded-xl border border-border bg-card">
            <VRMAvatar
              vrmUrl={vrmUrl}
              audioElement={audioRef.current}
              expression={expression}
              isSleeping={isSleeping}
            />
          </div>

          <aside className="flex flex-col gap-4 rounded-xl border border-border bg-card p-4">
            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                VRM file
              </h2>
              <input
                type="file"
                accept=".vrm,application/octet-stream"
                onChange={onVrmFile}
                className="block w-full text-sm"
              />
              <p className="break-all text-xs text-muted-foreground">
                {vrmUrl}
              </p>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Audio
              </h2>
              <input
                type="file"
                accept="audio/*"
                onChange={onAudioFile}
                className="block w-full text-sm"
              />
              <div className="flex items-center gap-2">
                <Button
                  size="sm"
                  onClick={togglePlay}
                  disabled={!audioUrl}
                  variant={isPlaying ? 'secondary' : 'default'}
                >
                  {isPlaying ? 'Pause' : 'Play'}
                </Button>
                <audio
                  ref={audioRef}
                  src={audioUrl ?? undefined}
                  onPlay={() => setIsPlaying(true)}
                  onPause={() => setIsPlaying(false)}
                  onEnded={() => setIsPlaying(false)}
                  controls
                  className="flex-1"
                />
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Expressions
              </h2>
              <div className="grid grid-cols-3 gap-2">
                {EXPRESSIONS.map((expr) => (
                  <Button
                    key={expr}
                    size="sm"
                    variant={expression === expr ? 'default' : 'secondary'}
                    onClick={() => setAndHold(expr)}
                  >
                    {expr}
                  </Button>
                ))}
              </div>
            </section>

            <section className="space-y-2">
              <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
                Sleep
              </h2>
              <Button
                size="sm"
                variant={isSleeping ? 'default' : 'secondary'}
                onClick={() => setIsSleeping((s) => !s)}
                className={cn('w-full', isSleeping && 'bg-blue-500/80')}
              >
                {isSleeping ? 'Wake' : 'Sleep'}
              </Button>
            </section>
          </aside>
        </div>
      </div>
    </main>
  );
}
