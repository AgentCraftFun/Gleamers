import type { Metadata } from 'next';
import { headers } from 'next/headers';
import { Providers } from './providers';
import './globals.css';

export const metadata: Metadata = {
  title: 'Gleamers',
  description: 'AI VTuber streaming platform',
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const cookie = headers().get('cookie') ?? null;
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        <Providers cookie={cookie}>{children}</Providers>
      </body>
    </html>
  );
}
