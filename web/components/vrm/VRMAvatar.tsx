'use client';

import dynamic from 'next/dynamic';
import type { VRMAvatarProps } from './types';

const VRMScene = dynamic(() => import('./VRMScene'), {
  ssr: false,
  loading: () => (
    <div className="flex h-full w-full items-center justify-center rounded-lg bg-card text-sm text-muted-foreground">
      Loading avatar…
    </div>
  ),
});

export function VRMAvatar(props: VRMAvatarProps) {
  return <VRMScene {...props} />;
}

export type { AvatarExpression, VRMAvatarProps } from './types';
