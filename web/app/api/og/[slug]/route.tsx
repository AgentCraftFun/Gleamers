import { ImageResponse } from 'next/og';
import { createSupabaseAdmin } from '@/lib/supabase';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STATUS_COPY: Record<string, { label: string; tint: string }> = {
  LIVE: { label: 'LIVE', tint: '#4ade80' },
  COOLING_DOWN: { label: 'COOLING DOWN', tint: '#fb923c' },
  READY: { label: 'READY', tint: '#60a5fa' },
  OFFLINE: { label: 'OFFLINE', tint: '#a1a1aa' },
};

export async function GET(
  _req: Request,
  ctx: { params: { slug: string } },
) {
  const { slug } = ctx.params;
  let streamer: {
    name: string;
    slug: string;
    status: string;
    owner_wallet: string;
    total_sessions: number;
  } | null = null;
  try {
    const sb = createSupabaseAdmin();
    const { data } = await sb
      .from('streamers')
      .select('name, slug, status, owner_wallet, total_sessions')
      .eq('slug', slug)
      .maybeSingle();
    if (data) streamer = data;
  } catch {
    /* fall through to fallback OG */
  }

  const name = streamer?.name ?? slug;
  const initial = (name.trim().charAt(0) || '?').toUpperCase();
  const status = STATUS_COPY[streamer?.status ?? ''] ?? STATUS_COPY.OFFLINE;
  const owner = streamer?.owner_wallet
    ? `${streamer.owner_wallet.slice(0, 6)}…${streamer.owner_wallet.slice(-4)}`
    : null;
  const sessions = streamer?.total_sessions ?? 0;

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          backgroundColor: '#0a0a0b',
          backgroundImage:
            'radial-gradient(ellipse at top right, rgba(168, 85, 247, 0.9), #0a0a0b 70%)',
          color: '#f4f4f5',
          fontFamily: 'system-ui, -apple-system, sans-serif',
          padding: 64,
          gap: 48,
          alignItems: 'center',
        }}
      >
        <div
          style={{
            width: 280,
            height: 280,
            borderRadius: 32,
            backgroundImage:
              'linear-gradient(135deg, #c084fc, #f472b6, #fbbf24)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'center',
            fontSize: 180,
            fontWeight: 700,
            flexShrink: 0,
          }}
        >
          {initial}
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 12,
              fontSize: 22,
              color: 'rgba(244,244,245,0.7)',
              letterSpacing: 4,
              textTransform: 'uppercase',
            }}
          >
            <span style={{ fontWeight: 600, color: status.tint }}>
              {status.label}
            </span>
            <span style={{ color: 'rgba(244,244,245,0.35)' }}>·</span>
            <span>Gleamers</span>
          </div>
          <div style={{ fontSize: 96, fontWeight: 700, lineHeight: 1 }}>
            {name}
          </div>
          <div
            style={{
              display: 'flex',
              gap: 20,
              marginTop: 8,
              fontSize: 24,
              color: 'rgba(244,244,245,0.8)',
            }}
          >
            {owner ? (
              <span
                style={{
                  padding: '6px 14px',
                  borderRadius: 999,
                  background: 'rgba(244,244,245,0.08)',
                  fontFamily: 'ui-monospace, Menlo, monospace',
                  fontSize: 20,
                }}
              >
                by {owner}
              </span>
            ) : null}
            <span
              style={{
                padding: '6px 14px',
                borderRadius: 999,
                background: 'rgba(244,244,245,0.08)',
                fontSize: 20,
              }}
            >
              {sessions} session{sessions === 1 ? '' : 's'}
            </span>
          </div>
        </div>
      </div>
    ),
    { width: 1200, height: 630 },
  );
}
