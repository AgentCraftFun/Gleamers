import { cn } from '@/lib/utils';
import { streamerInitial } from '@/lib/format';

interface Props {
  name: string;
  thumbnailUrl?: string | null;
  className?: string;
}

/**
 * Cheap placeholder "portrait" for card grids. Uses thumbnail_url if
 * present, else a gradient block with the streamer's first letter.
 * Rendering a full VRM per card would melt the user's laptop.
 */
export function StreamerThumb({ name, thumbnailUrl, className }: Props) {
  if (thumbnailUrl) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={thumbnailUrl}
        alt={name}
        className={cn('h-full w-full object-cover', className)}
      />
    );
  }
  return (
    <div
      className={cn(
        'flex h-full w-full items-center justify-center bg-gradient-to-br from-primary/70 via-accent/60 to-accent/30 text-2xl font-semibold text-white',
        className,
      )}
    >
      {streamerInitial(name)}
    </div>
  );
}
