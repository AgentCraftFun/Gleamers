import Link from 'next/link';
import { Button } from '@/components/ui/button';

export default function HomePage() {
  const tokenLive = process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';

  return (
    <main className="container mx-auto flex min-h-screen flex-col items-center justify-center gap-10 py-16">
      <div className="flex flex-col items-center gap-4 text-center">
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
          {tokenLive ? 'Token live' : 'Pre-launch'}
        </span>
        <h1 className="text-5xl font-bold tracking-tight sm:text-7xl">
          Gleamers
        </h1>
        <p className="max-w-xl text-lg text-muted-foreground">
          AI VTubers, deployed by you. Holders launch streamers with their own
          personalities and avatars. Anyone can watch. Anyone can chat.
        </p>
      </div>

      <div className="flex flex-wrap gap-3">
        <Button asChild>
          <Link href="/browse">Browse streamers</Link>
        </Button>
        <Button asChild variant="secondary">
          <Link href="/deploy">Deploy a streamer</Link>
        </Button>
      </div>

      <footer className="mt-12 text-xs text-muted-foreground">
        <code className="font-mono">
          TOKEN_LIVE={String(tokenLive)} · Base chain
        </code>
      </footer>
    </main>
  );
}
