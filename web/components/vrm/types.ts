export type AvatarExpression =
  | 'neutral'
  | 'happy'
  | 'angry'
  | 'surprised'
  | 'thinking'
  | 'laughing';

export interface VRMAvatarProps {
  vrmUrl: string;
  audioElement?: HTMLAudioElement | null;
  expression?: AvatarExpression;
  isSleeping?: boolean;
  className?: string;
}
