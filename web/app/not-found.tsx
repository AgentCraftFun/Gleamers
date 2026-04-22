import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function NotFound() {
  return (
    <main className="mx-auto flex min-h-screen max-w-xl flex-col items-center justify-center gap-5 px-6 text-center">
      <span className="rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
        404
      </span>
      <h1 className="text-3xl font-semibold tracking-tight">
        That page drifted off.
      </h1>
      <p className="text-sm text-muted-foreground">
        The slug may be retired, the URL could be typo&apos;d, or the
        streamer was never deployed. Head back and try again.
      </p>
      <div className="flex gap-2">
        <Button asChild>
          <Link href="/">Home</Link>
        </Button>
        <Button asChild variant="outline">
          <Link href="/deploy">Deploy a streamer</Link>
        </Button>
      </div>
    </main>
  );
}
