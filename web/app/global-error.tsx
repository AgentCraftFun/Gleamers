'use client';

import { useEffect } from 'react';

export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error('[global error]', error);
  }, [error]);

  return (
    <html lang="en">
      <body
        style={{
          minHeight: '100vh',
          background: '#0a0a0b',
          color: '#f4f4f5',
          display: 'grid',
          placeItems: 'center',
          fontFamily: 'system-ui, sans-serif',
          padding: 24,
          textAlign: 'center',
        }}
      >
        <div style={{ maxWidth: 440 }}>
          <h1 style={{ fontSize: 28, marginBottom: 12 }}>
            Everything broke at once.
          </h1>
          <p style={{ opacity: 0.75, fontSize: 14 }}>
            Even our recovery layer crashed. Refresh the page.
          </p>
          {error.digest ? (
            <code
              style={{
                display: 'inline-block',
                marginTop: 12,
                padding: '4px 8px',
                background: '#1a1a1d',
                borderRadius: 4,
                fontSize: 11,
              }}
            >
              ref: {error.digest}
            </code>
          ) : null}
          <div style={{ marginTop: 20 }}>
            <button
              onClick={reset}
              style={{
                padding: '8px 16px',
                background: 'hsl(280 80% 60%)',
                color: '#fff',
                border: 'none',
                borderRadius: 6,
                cursor: 'pointer',
              }}
            >
              Try again
            </button>
          </div>
        </div>
      </body>
    </html>
  );
}
