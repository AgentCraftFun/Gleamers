'use client';

import { useMemo } from 'react';
import { SiweMessage } from 'siwe';
import {
  RainbowKitAuthenticationProvider,
  createAuthenticationAdapter,
  ConnectButton,
  type AuthenticationStatus,
} from '@rainbow-me/rainbowkit';
import { useAccount, useDisconnect } from 'wagmi';

import { useMe } from '@/lib/auth/useMe';
import { track } from '@/lib/analytics';
import { cn } from '@/lib/utils';

function formatBalance(raw: string | null): string | null {
  if (!raw || raw === '0') return null;
  // The token has unknown decimals in the scaffold — display the raw
  // integer with separators; tighter formatting lands once decimals
  // are known.
  try {
    return BigInt(raw).toLocaleString();
  } catch {
    return null;
  }
}

export function ConnectWalletButton() {
  const { me, refresh } = useMe();
  const { address } = useAccount();
  const { disconnect } = useDisconnect();

  const authStatus: AuthenticationStatus = useMemo(() => {
    if (!me) return 'loading';
    if (me.is_anonymous) return 'unauthenticated';
    return 'authenticated';
  }, [me]);

  const adapter = useMemo(
    () =>
      createAuthenticationAdapter<string>({
        getNonce: async () => {
          const res = await fetch('/api/auth/nonce', { cache: 'no-store' });
          if (!res.ok) throw new Error('nonce_fetch_failed');
          const { nonce } = (await res.json()) as { nonce: string };
          return nonce;
        },
        createMessage: ({ nonce, address, chainId }) => {
          const siwe = new SiweMessage({
            domain:
              typeof window !== 'undefined'
                ? window.location.host
                : 'gleamers',
            address,
            statement: 'Sign in to Gleamers',
            uri:
              typeof window !== 'undefined'
                ? window.location.origin
                : 'https://gleamers',
            version: '1',
            chainId,
            nonce,
          });
          return siwe.prepareMessage();
        },
        verify: async ({ message, signature }) => {
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message, signature }),
          });
          if (res.ok) {
            const body = (await res.json().catch(() => ({}))) as {
              walletAddress?: string;
            };
            if (body.walletAddress) {
              track({ name: 'wallet_connected', address: body.walletAddress });
            }
            await refresh();
            return true;
          }
          return false;
        },
        signOut: async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          await refresh();
          disconnect();
        },
      }),
    [refresh, disconnect],
  );

  return (
    <RainbowKitAuthenticationProvider adapter={adapter} status={authStatus}>
      <ConnectButton.Custom>
        {({
          account,
          chain,
          openAccountModal,
          openChainModal,
          openConnectModal,
          authenticationStatus,
          mounted,
        }) => {
          const ready = mounted && authenticationStatus !== 'loading';
          const connected =
            ready &&
            account &&
            chain &&
            (!authenticationStatus || authenticationStatus === 'authenticated');
          return (
            <div
              aria-hidden={!ready}
              className={cn(!ready && 'pointer-events-none opacity-0')}
            >
              {(() => {
                if (!connected) {
                  return (
                    <button
                      onClick={openConnectModal}
                      type="button"
                      className="inline-flex h-9 items-center rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
                    >
                      Connect Wallet
                    </button>
                  );
                }
                if (chain.unsupported) {
                  return (
                    <button
                      onClick={openChainModal}
                      type="button"
                      className="inline-flex h-9 items-center rounded-md border border-destructive/60 bg-destructive/20 px-3 text-sm font-medium text-destructive-foreground"
                    >
                      Wrong network
                    </button>
                  );
                }
                const balanceText = formatBalance(
                  me?.token_balance_cached ?? null,
                );
                return (
                  <div className="flex items-center gap-2">
                    {me?.is_admin ? (
                      <span className="rounded-full border border-amber-500/50 bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-amber-200">
                        Admin
                      </span>
                    ) : null}
                    {balanceText ? (
                      <span className="hidden rounded-md border border-border bg-card px-2 py-1 font-mono text-xs sm:inline">
                        {balanceText}
                      </span>
                    ) : null}
                    <button
                      onClick={openAccountModal}
                      type="button"
                      className="inline-flex h-9 items-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-muted"
                    >
                      {address
                        ? `${address.slice(0, 6)}…${address.slice(-4)}`
                        : account.displayName}
                    </button>
                  </div>
                );
              })()}
            </div>
          );
        }}
      </ConnectButton.Custom>
    </RainbowKitAuthenticationProvider>
  );
}
