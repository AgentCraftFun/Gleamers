import type { MetadataRoute } from 'next';
import { createSupabaseAdmin } from '@/lib/supabase';

export const revalidate = 300;

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    (process.env.VERCEL_URL
      ? `https://${process.env.VERCEL_URL}`
      : 'http://localhost:3000')
  ).replace(/\/$/, '');
}

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const base = siteUrl();
  const staticEntries: MetadataRoute.Sitemap = [
    { url: `${base}/`, changeFrequency: 'hourly', priority: 1.0 },
    { url: `${base}/deploy`, changeFrequency: 'weekly', priority: 0.6 },
  ];

  try {
    const sb = createSupabaseAdmin();
    const { data } = await sb
      .from('streamers')
      .select('slug, last_active_at, created_at')
      .in('status', ['LIVE', 'COOLING_DOWN', 'READY'])
      .order('created_at', { ascending: false })
      .limit(1000);
    const rows: MetadataRoute.Sitemap = (data ?? []).map((s) => ({
      url: `${base}/s/${encodeURIComponent(s.slug)}`,
      lastModified: s.last_active_at
        ? new Date(s.last_active_at)
        : new Date(s.created_at),
      changeFrequency: 'hourly',
      priority: 0.7,
    }));
    return [...staticEntries, ...rows];
  } catch {
    return staticEntries;
  }
}
