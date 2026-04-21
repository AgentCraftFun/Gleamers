'use client';

import Link from 'next/link';
import { Button } from '@/components/ui/button';
import { DeployWizard } from '@/components/deploy/DeployWizard';
import { WaitlistGate } from '@/components/deploy/WaitlistGate';
import { useMe } from '@/lib/auth/useMe';
import { useConnectModal } from '@rainbow-me/rainbowkit';

interface Props {
  tokenLive: boolean;
}

export default function DeployClient({ tokenLive }: Props) {
  const { me, loading } = useMe();
  const { openConnectModal } = useConnectModal();

  if (loading || !me) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-16 text-center text-sm text-muted-foreground">
        Loading…
      </main>
    );
  }

  // --- PRE-TOKEN gating -----------------------------------------------
  if (!tokenLive) {
    if (me.is_anonymous || !me.wallet_address) {
      // Non-admin by default; admin requires a SIWE session anyway.
      return (
        <main className="mx-auto max-w-3xl px-4 py-10">
          <NotConnectedCallout tokenLive={tokenLive} onConnect={openConnectModal} />
          <WaitlistGate />
        </main>
      );
    }
    if (!me.is_admin) {
      return (
        <main className="mx-auto max-w-3xl px-4 py-10">
          <WaitlistGate />
        </main>
      );
    }
    // Admin pre-token: full flow, no fee.
    return (
      <main className="mx-auto max-w-3xl px-4 py-6">
        <Header tokenLive={false} isAdmin />
        <DeployWizard tokenLive={false} isAdmin />
      </main>
    );
  }

  // --- POST-TOKEN -----------------------------------------------------
  if (me.is_anonymous || !me.wallet_address) {
    return (
      <main className="mx-auto max-w-3xl px-4 py-10">
        <NotConnectedCallout tokenLive={tokenLive} onConnect={openConnectModal} />
      </main>
    );
  }
  return (
    <main className="mx-auto max-w-3xl px-4 py-6">
      <Header tokenLive={true} isAdmin={me.is_admin} />
      <DeployWizard tokenLive={true} isAdmin={me.is_admin} />
    </main>
  );
}

function Header({ tokenLive, isAdmin }: { tokenLive: boolean; isAdmin: boolean }) {
  return (
    <div className="mb-4 flex items-start justify-between gap-4">
      <div>
        <Link
          href="/"
          className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
        >
          ← Gleamers
        </Link>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Deploy a streamer
        </h1>
        <p className="text-sm text-muted-foreground">
          {tokenLive
            ? isAdmin
              ? 'Admin deploys are free.'
              : 'Pay the deploy fee on Base; debut starts immediately.'
            : isAdmin
              ? 'Pre-launch admin deploy — no fee while TOKEN_LIVE is off.'
              : 'Pre-launch waitlist only.'}
        </p>
      </div>
    </div>
  );
}

function NotConnectedCallout({
  tokenLive,
  onConnect,
}: {
  tokenLive: boolean;
  onConnect: (() => void) | undefined;
}) {
  return (
    <section className="mb-8 rounded-xl border border-border bg-card p-5">
      <h2 className="text-lg font-semibold">Connect a wallet first</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {tokenLive
          ? 'Deploying requires a wallet + SIWE sign-in (and the deploy fee in tokens).'
          : 'Admin deploys are gated by SIWE. Non-admins should join the waitlist below.'}
      </p>
      <div className="mt-3">
        <Button type="button" onClick={() => onConnect?.()}>
          Connect Wallet
        </Button>
      </div>
    </section>
  );
}
