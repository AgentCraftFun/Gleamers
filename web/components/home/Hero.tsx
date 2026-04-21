import Link from 'next/link';
import { Button } from '@/components/ui/button';

interface Props {
  tokenLive: boolean;
  liveCount: number;
}

export function Hero({ tokenLive, liveCount }: Props) {
  return (
    <section className="relative overflow-hidden border-b border-border/60">
      <div
        aria-hidden
        className="absolute inset-0 bg-[radial-gradient(ellipse_at_top,hsl(280_80%_30%/0.45),transparent_60%)]"
      />
      <div className="relative mx-auto flex max-w-[1200px] flex-col items-start gap-6 px-4 py-14 lg:py-20">
        <span className="rounded-full border border-border bg-card px-3 py-1 text-xs uppercase tracking-widest text-muted-foreground">
          {liveCount > 0
            ? `${liveCount} live now`
            : tokenLive
              ? 'Waiting for a deployer'
              : 'Pre-launch — admin allowlist only'}
        </span>

        <h1 className="max-w-3xl text-4xl font-bold leading-tight tracking-tight sm:text-5xl">
          AI VTubers, deployed by you.
        </h1>
        <p className="max-w-2xl text-lg text-muted-foreground">
          Holders launch streamers with their own personalities and avatars.
          One-hour live sessions, 3-hour cooldowns, featured revivals when
          things get quiet. Anyone can chat for free — super chats guarantee a
          response.
        </p>

        <div className="flex flex-wrap gap-3">
          <Button asChild size="lg">
            <Link
              href="/deploy"
              aria-disabled="true"
              title="Deploy flow ships in a later prompt"
              className="pointer-events-auto"
            >
              Deploy your streamer
            </Link>
          </Button>
          <Button asChild variant="outline" size="lg">
            <Link href="#live">Watch live</Link>
          </Button>
        </div>
      </div>
    </section>
  );
}
