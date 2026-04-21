'use client';

import { useCallback, useEffect, useState } from 'react';

export interface MeResponse {
  id: string | null;
  wallet_address: string | null;
  display_name: string | null;
  is_admin: boolean;
  is_anonymous: boolean;
  anonymous_id?: string;
  token_balance_cached: string | null;
}

interface UseMeResult {
  me: MeResponse | null;
  loading: boolean;
  refresh: () => Promise<void>;
}

export function useMe(): UseMeResult {
  const [me, setMe] = useState<MeResponse | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetch('/api/me', { cache: 'no-store' });
      if (!res.ok) {
        setMe(null);
        return;
      }
      setMe((await res.json()) as MeResponse);
    } catch (err) {
      console.warn('[useMe] fetch failed', err);
      setMe(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  return { me, loading, refresh };
}
