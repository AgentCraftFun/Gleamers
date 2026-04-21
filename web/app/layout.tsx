import type { Metadata } from 'next';
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
  return (
    <html lang="en" className="dark">
      <body className="min-h-screen bg-background text-foreground antialiased">
        {children}
      </body>
    </html>
  );
}
