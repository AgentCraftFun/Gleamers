'use client';

import { useState } from 'react';
import { Button } from '@/components/ui/button';

interface Props {
  url?: string;
  label?: string;
  shareTitle?: string;
  shareText?: string;
}

export function ShareButton({
  url,
  label = 'Share',
  shareTitle,
  shareText,
}: Props) {
  const [state, setState] = useState<'idle' | 'copied' | 'shared' | 'error'>(
    'idle',
  );

  async function onClick() {
    const targetUrl =
      url ??
      (typeof window !== 'undefined' ? window.location.href : '');
    if (!targetUrl) return;

    // Native share when available (mobile / some desktops).
    if (typeof navigator !== 'undefined' && 'share' in navigator) {
      try {
        await (
          navigator as Navigator & {
            share: (data: ShareData) => Promise<void>;
          }
        ).share({
          title: shareTitle,
          text: shareText,
          url: targetUrl,
        });
        setState('shared');
        return;
      } catch {
        /* user cancelled or share unavailable — fall through to copy */
      }
    }
    try {
      await navigator.clipboard.writeText(targetUrl);
      setState('copied');
      window.setTimeout(() => setState('idle'), 1800);
    } catch {
      setState('error');
      window.setTimeout(() => setState('idle'), 1800);
    }
  }

  const text =
    state === 'copied' ? 'Copied ✓'
      : state === 'shared' ? 'Shared'
      : state === 'error' ? 'Copy failed'
      : label;

  return (
    <Button type="button" variant="outline" size="sm" onClick={onClick}>
      {text}
    </Button>
  );
}
