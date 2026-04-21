import type { StreamerStatus } from '@gleamers/shared';

export interface HomeStreamer {
  id: string;
  slug: string;
  name: string;
  owner_wallet: string;
  status: StreamerStatus;
  thumbnail_url: string | null;
  ready_at: string | null;
  last_active_at: string | null;
  current_session_id: string | null;
}
