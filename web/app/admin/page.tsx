import { notFound, redirect } from 'next/navigation';
import Link from 'next/link';
import { createSupabaseAdmin } from '@/lib/supabase';
import { readSession } from '@/lib/auth/session';
import { Header } from '@/components/home/Header';
import { truncateWallet } from '@/lib/format';

export const dynamic = 'force-dynamic';

function sumBigint(strings: Array<string | null | undefined>): bigint {
  let total = 0n;
  for (const s of strings) {
    if (!s) continue;
    try {
      total += BigInt(s);
    } catch {
      /* skip malformed */
    }
  }
  return total;
}

function tokens(amount: bigint, decimals = 18): string {
  if (amount === 0n) return '0';
  const whole = amount / 10n ** BigInt(decimals);
  const frac = amount % 10n ** BigInt(decimals);
  if (frac === 0n) return whole.toLocaleString();
  const fracStr = frac
    .toString()
    .padStart(decimals, '0')
    .slice(0, 3)
    .replace(/0+$/, '');
  return `${whole.toLocaleString()}${fracStr ? `.${fracStr}` : ''}`;
}

export default async function AdminPage() {
  const session = await readSession();
  if (!session) redirect('/');
  if (!session.isAdmin) notFound();

  const tokenLive = process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
  const sb = createSupabaseAdmin();

  // Status counts
  const [liveRes, coolingRes, readyRes, offlineRes] = await Promise.all([
    sb
      .from('streamers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'LIVE'),
    sb
      .from('streamers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'COOLING_DOWN'),
    sb
      .from('streamers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'READY'),
    sb
      .from('streamers')
      .select('id', { count: 'exact', head: true })
      .eq('status', 'OFFLINE'),
  ]);

  // Recent payment events for aggregates.
  const sinceIso = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
  const { data: recentPayments } = await sb
    .from('payment_events')
    .select(
      'event_type, amount, owner_payout, treasury_share, burn_amount, treasury_amount, created_at, streamer_id, tx_hash',
    )
    .gte('created_at', sinceIso)
    .order('created_at', { ascending: false });

  // All-time aggregates.
  const { data: allPayments } = await sb
    .from('payment_events')
    .select('event_type, amount, owner_payout, treasury_share, burn_amount, treasury_amount');

  const superChats24h =
    recentPayments?.filter((p) => p.event_type === 'super_chat') ?? [];
  const deployFees24h =
    recentPayments?.filter((p) => p.event_type === 'deploy_fee') ?? [];
  const superChatsAll =
    allPayments?.filter((p) => p.event_type === 'super_chat') ?? [];
  const deployFeesAll =
    allPayments?.filter((p) => p.event_type === 'deploy_fee') ?? [];

  const revenue24h = sumBigint([
    ...superChats24h.map((p) => p.owner_payout),
    ...superChats24h.map((p) => p.treasury_share),
  ]);
  const treasury24h = sumBigint([
    ...superChats24h.map((p) => p.treasury_share),
    ...deployFees24h.map((p) => p.treasury_amount),
  ]);
  const burn24h = sumBigint(deployFees24h.map((p) => p.burn_amount));

  const treasuryAll = sumBigint([
    ...superChatsAll.map((p) => p.treasury_share),
    ...deployFeesAll.map((p) => p.treasury_amount),
  ]);
  const burnAll = sumBigint(deployFeesAll.map((p) => p.burn_amount));
  const ownerPayoutsAll = sumBigint(superChatsAll.map((p) => p.owner_payout));

  // Top streamers by lifetime super chat earnings.
  const { data: topStreamers } = await sb
    .from('streamers')
    .select(
      'slug, name, owner_wallet, status, total_sessions, total_super_chat_earnings',
    )
    .order('total_super_chat_earnings', { ascending: false })
    .limit(10);

  return (
    <div className="min-h-screen bg-background">
      <Header tokenLive={tokenLive} />
      <main className="mx-auto max-w-6xl space-y-8 px-4 py-8 lg:px-6">
        <header className="flex items-start justify-between gap-4">
          <div>
            <Link
              href="/dashboard"
              className="text-xs uppercase tracking-widest text-muted-foreground hover:text-foreground"
            >
              ← Dashboard
            </Link>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Admin
            </h1>
            <p className="text-sm text-muted-foreground">
              {tokenLive ? 'Token live' : 'Pre-launch'} · gated by
              is_admin. Never exposed to the public.
            </p>
          </div>
        </header>

        <section className="grid gap-3 sm:grid-cols-4">
          <KV label="Live" value={String(liveRes.count ?? 0)} tone="emerald" />
          <KV
            label="Cooling"
            value={String(coolingRes.count ?? 0)}
            tone="orange"
          />
          <KV label="Ready" value={String(readyRes.count ?? 0)} tone="blue" />
          <KV
            label="Offline"
            value={String(offlineRes.count ?? 0)}
            tone="muted"
          />
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Block title="24h super-chat revenue (gross)" value={tokens(revenue24h)} />
          <Block title="24h treasury inflow" value={tokens(treasury24h)} />
          <Block title="24h burn" value={tokens(burn24h)} />
        </section>

        <section className="grid gap-3 sm:grid-cols-3">
          <Block
            title="All-time owner payouts"
            value={tokens(ownerPayoutsAll)}
          />
          <Block title="All-time treasury" value={tokens(treasuryAll)} />
          <Block title="All-time burn" value={tokens(burnAll)} />
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Top streamers by super-chat earnings
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-background/50 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">Streamer</th>
                  <th className="px-3 py-2">Owner</th>
                  <th className="px-3 py-2">Sessions</th>
                  <th className="px-3 py-2 text-right">Earnings</th>
                </tr>
              </thead>
              <tbody>
                {(topStreamers ?? []).map((s) => (
                  <tr key={s.slug} className="border-t border-border/60">
                    <td className="px-3 py-2">
                      <Link
                        href={`/s/${encodeURIComponent(s.slug)}`}
                        className="font-medium hover:underline"
                      >
                        {s.name}
                      </Link>
                      <span className="ml-2 text-[11px] uppercase tracking-widest text-muted-foreground">
                        {s.status}
                      </span>
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px] text-muted-foreground">
                      {truncateWallet(s.owner_wallet)}
                    </td>
                    <td className="px-3 py-2">{s.total_sessions}</td>
                    <td className="px-3 py-2 text-right font-mono">
                      {tokens(BigInt(s.total_super_chat_earnings ?? '0'))}
                    </td>
                  </tr>
                ))}
                {!topStreamers?.length ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No earnings yet.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <section className="space-y-2">
          <h2 className="text-sm font-semibold uppercase tracking-widest text-muted-foreground">
            Last 24h on-chain events
          </h2>
          <div className="overflow-hidden rounded-xl border border-border bg-card">
            <table className="w-full text-sm">
              <thead className="bg-background/50 text-left text-[11px] uppercase tracking-widest text-muted-foreground">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Type</th>
                  <th className="px-3 py-2 text-right">Amount</th>
                  <th className="px-3 py-2">Tx</th>
                </tr>
              </thead>
              <tbody>
                {(recentPayments ?? []).slice(0, 30).map((p) => (
                  <tr
                    key={p.tx_hash}
                    className="border-t border-border/60"
                  >
                    <td className="px-3 py-2 text-[11px] text-muted-foreground">
                      {new Date(p.created_at).toLocaleString()}
                    </td>
                    <td className="px-3 py-2">
                      <span
                        className={
                          p.event_type === 'super_chat'
                            ? 'rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-semibold text-emerald-200'
                            : 'rounded-full bg-amber-500/15 px-2 py-0.5 text-[10px] font-semibold text-amber-200'
                        }
                      >
                        {p.event_type}
                      </span>
                    </td>
                    <td className="px-3 py-2 text-right font-mono">
                      {tokens(BigInt(p.amount ?? '0'))}
                    </td>
                    <td className="px-3 py-2 font-mono text-[11px]">
                      {p.tx_hash.slice(0, 10)}…{p.tx_hash.slice(-6)}
                    </td>
                  </tr>
                ))}
                {!recentPayments?.length ? (
                  <tr>
                    <td
                      colSpan={4}
                      className="px-3 py-6 text-center text-muted-foreground"
                    >
                      No on-chain events in the last 24h.
                    </td>
                  </tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>

        <aside className="rounded-xl border border-border bg-card/70 p-4 text-xs text-muted-foreground">
          <p className="font-semibold text-foreground">Cost telemetry</p>
          <p className="mt-1">
            Per-streamer LLM token + TTS char accounting will land once the
            worker starts emitting usage events. For now, revenue + on-chain
            totals above are exact; cost numbers are tracked externally.
          </p>
        </aside>
      </main>
    </div>
  );
}

function KV({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone: 'emerald' | 'orange' | 'blue' | 'muted';
}) {
  const tones = {
    emerald: 'border-emerald-500/40 text-emerald-200',
    orange: 'border-orange-500/40 text-orange-200',
    blue: 'border-blue-500/40 text-blue-200',
    muted: 'border-border text-muted-foreground',
  };
  return (
    <div className={`rounded-xl border bg-card p-4 ${tones[tone]}`}>
      <div className="text-[11px] uppercase tracking-widest">{label}</div>
      <div className="mt-1 font-mono text-3xl text-foreground">{value}</div>
    </div>
  );
}

function Block({ title, value }: { title: string; value: string }) {
  return (
    <div className="rounded-xl border border-border bg-card p-4">
      <div className="text-[11px] uppercase tracking-widest text-muted-foreground">
        {title}
      </div>
      <div className="mt-1 font-mono text-2xl">{value}</div>
    </div>
  );
}
