'use client';

import { cn } from '@/lib/utils';

const BARS = 7;

interface Props {
  active: boolean;
  className?: string;
}

/**
 * Lightweight animated waveform: seven bars, each with its own CSS
 * animation delay, animating when `active` is true. No canvas, no
 * audio — just a visual cue driven by the orchestrator's
 * speaking-status hash.
 */
export function Waveform({ active, className }: Props) {
  return (
    <div
      className={cn(
        'flex h-4 items-end gap-[2px]',
        className,
      )}
      aria-hidden
    >
      {Array.from({ length: BARS }).map((_, i) => (
        <span
          key={i}
          className={cn(
            'w-[2px] origin-bottom rounded-sm bg-current',
            active ? 'animate-wave' : 'h-[30%] opacity-50',
          )}
          style={
            active
              ? {
                  animationDelay: `${i * 80}ms`,
                  animationDuration: `${700 + (i % 3) * 140}ms`,
                }
              : undefined
          }
        />
      ))}
    </div>
  );
}
