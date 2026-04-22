'use client';

import { useEffect } from 'react';
import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function AppError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[app error]', error);
  }, [error]);

  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="rounded-full border border-destructive/60 bg-destructive/15 px-3 py-1 text-xs uppercase tracking-widest text-destructive-foreground">
        Something broke
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">
        We hit a server snag.
      </h1>
      <p className="text-sm text-muted-foreground">
        Refresh the page or head back to the homepage — your session should
        pick right back up. If it keeps happening, the issue is on our end.
      </p>
      {error.digest ? (
        <code className="rounded-md border border-border bg-card px-2 py-1 font-mono text-[11px] text-muted-foreground">
          ref: {error.digest}
        </code>
      ) : null}
      <div className="flex gap-2">
        <Button onClick={reset} variant="default">
          Try again
        </Button>
        <Button asChild variant="outline">
          <Link href="/">Home</Link>
        </Button>
      </div>
    </main>
  );
}
