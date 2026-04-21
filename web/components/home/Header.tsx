import Link from 'next/link';
import { ConnectWalletButton } from '@/components/auth/ConnectWalletButton';

interface Props {
  tokenLive: boolean;
}

export function Header({ tokenLive }: Props) {
  return (
    <header className="border-b border-border/60 bg-background/80 backdrop-blur">
      <div className="mx-auto flex h-16 max-w-[1600px] items-center justify-between gap-4 px-4 lg:px-6">
        <Link
          href="/"
          className="flex items-center gap-2 text-lg font-semibold tracking-tight"
        >
          <span className="inline-block size-6 rounded-sm bg-gradient-to-br from-primary to-accent" />
          Gleamers
        </Link>

        <nav className="hidden items-center gap-6 text-sm text-muted-foreground sm:flex">
          <Link href="/" className="hover:text-foreground">
            Discover
          </Link>
          <Link href="/deploy" className="hover:text-foreground">
            Deploy
          </Link>
          <Link href="/dashboard" className="hover:text-foreground">
            Dashboard
          </Link>
        </nav>

        <div className="flex items-center gap-2">
          <span className="rounded-full border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-widest text-muted-foreground">
            {tokenLive ? 'Token live' : 'Pre-launch'}
          </span>
          <ConnectWalletButton />
        </div>
      </div>
    </header>
  );
}
