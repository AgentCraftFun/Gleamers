'use client';

import { useState } from 'react';
import { useAccount } from 'wagmi';
import { useConnectModal } from '@rainbow-me/rainbowkit';

import { Button } from '@/components/ui/button';
import { SuperChatModal } from './SuperChatModal';
import { isTokenLive } from '@/lib/super-chat/flags';

interface Props {
  slug: string;
  disabled?: boolean;
}

export function SuperChatButton({ slug, disabled }: Props) {
  const live = isTokenLive();
  const [open, setOpen] = useState(false);
  const { isConnected } = useAccount();
  const { openConnectModal } = useConnectModal();

  if (!live) {
    return (
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled
        title="Super chats coming soon"
        aria-label="Super chats coming soon"
      >
        ⭐ Super chat
      </Button>
    );
  }

  return (
    <>
      <Button
        type="button"
        variant="outline"
        size="sm"
        disabled={disabled}
        onClick={() => {
          if (!isConnected) {
            openConnectModal?.();
            return;
          }
          setOpen(true);
        }}
      >
        ⭐ Super chat
      </Button>
      <SuperChatModal slug={slug} open={open} onClose={() => setOpen(false)} />
    </>
  );
}
