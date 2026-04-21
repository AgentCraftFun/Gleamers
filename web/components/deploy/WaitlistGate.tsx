'use client';

import { useState, type FormEvent } from 'react';
import { Button } from '@/components/ui/button';

export function WaitlistGate() {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<'idle' | 'sending' | 'done' | 'error'>(
    'idle',
  );
  const [message, setMessage] = useState<string | null>(null);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email) return;
    setState('sending');
    setMessage(null);
    try {
      const res = await fetch('/api/waitlist', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, source: 'deploy_gate' }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setState('error');
        setMessage(body.error ?? `Failed (${res.status})`);
        return;
      }
      setState('done');
      setMessage("You're on the list.");
    } catch (err) {
      setState('error');
      setMessage(String(err));
    }
  }

  return (
    <main className="mx-auto flex max-w-xl flex-col items-center gap-5 py-20 text-center">
      <span className="rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
        Pre-launch
      </span>
      <h1 className="text-3xl font-semibold sm:text-4xl">
        Deployment coming soon at token launch
      </h1>
      <p className="text-muted-foreground">
        Right now deploys are limited to the admin allowlist while we shake
        things out. Drop your email and we&apos;ll ping you the moment deploys
        open to the whole community.
      </p>
      <form onSubmit={onSubmit} className="flex w-full max-w-md gap-2">
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="you@example.com"
          required
          disabled={state === 'sending' || state === 'done'}
          className="flex-1 rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60"
        />
        <Button type="submit" disabled={state === 'sending' || state === 'done'}>
          {state === 'sending'
            ? 'Adding…'
            : state === 'done'
              ? 'Joined ✓'
              : 'Notify me'}
        </Button>
      </form>
      {message ? (
        <p
          className={
            state === 'error'
              ? 'text-sm text-destructive-foreground'
              : 'text-sm text-emerald-300'
          }
        >
          {message}
        </p>
      ) : null}
    </main>
  );
}
