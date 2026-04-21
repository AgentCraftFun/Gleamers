import Link from 'next/link';

export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-4 p-6 text-center">
      <h1 className="text-3xl font-semibold">Streamer not found</h1>
      <p className="text-muted-foreground">
        That slug isn&apos;t deployed — maybe it was retired.
      </p>
      <Link
        href="/"
        className="text-sm text-primary underline-offset-4 hover:underline"
      >
        Back to Gleamers
      </Link>
    </main>
  );
}
