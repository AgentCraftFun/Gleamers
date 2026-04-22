import type { MetadataRoute } from 'next';

function siteUrl(): string {
  return (
    process.env.NEXT_PUBLIC_SITE_URL ??
    process.env.VERCEL_URL ??
    'http://localhost:3000'
  ).replace(/^(https?:\/\/)?/, 'https://').replace(/\/$/, '');
}

export default function robots(): MetadataRoute.Robots {
  return {
    rules: [
      {
        userAgent: '*',
        allow: '/',
        disallow: ['/api/', '/dashboard', '/dashboard/*', '/admin'],
      },
    ],
    sitemap: `${siteUrl()}/sitemap.xml`,
  };
}
