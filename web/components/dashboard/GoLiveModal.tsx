'use client';

import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { Button } from '@/components/ui/button';
import { track } from '@/lib/analytics';

interface Props {
  slug: string;
  open: boolean;
  onClose: () => void;
}

export function GoLiveModal({ slug, open, onClose }: Props) {
  const router = useRouter();
  const [state, setState] =
    useState<'idle' | 'sending' | 'error'>('idle');
  const [error, setError] = useState<string | null>(null);

  async function confirm() {
    track({ name: 'go_live_clicked', slug });
    setState('sending');
    setError(null);
    try {
      const res = await fetch(
        `/api/streamers/${encodeURIComponent(slug)}/go-live`,
        { method: 'POST' },
      );
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setState('error');
        setError(body.error ?? `Failed (${res.status})`);
        return;
      }
      onClose();
      router.push(`/s/${encodeURIComponent(slug)}`);
      router.refresh();
    } catch (err) {
      setState('error');
      setError(String(err));
    }
  }

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
      onMouseDown={onClose}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-semibold">Go live now?</h2>
        <p className="mt-2 text-sm text-muted-foreground">
          A 60-minute session starts immediately and{' '}
          <span className="font-semibold text-foreground">
            cannot be stopped early
          </span>
          . After it ends there&apos;s a 3-hour cooldown before you can run
          another normal session.
        </p>
        {error ? (
          <p className="mt-3 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-sm text-destructive-foreground">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex items-center justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={state === 'sending'}>
            Cancel
          </Button>
          <Button onClick={confirm} disabled={state === 'sending'}>
            {state === 'sending' ? 'Starting…' : 'Go live'}
          </Button>
        </div>
      </div>
    </div>
  );
}
