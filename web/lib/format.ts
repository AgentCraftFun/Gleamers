export function truncateWallet(wallet: string): string {
  if (!wallet) return '';
  if (wallet.length <= 12) return wallet;
  return `${wallet.slice(0, 6)}…${wallet.slice(-4)}`;
}

export function formatMmSs(sec: number | null): string {
  if (sec === null || sec < 0) return '—';
  const m = Math.floor(sec / 60)
    .toString()
    .padStart(2, '0');
  const s = Math.max(0, Math.floor(sec % 60))
    .toString()
    .padStart(2, '0');
  return `${m}:${s}`;
}

export function formatHmmSs(sec: number | null): string {
  if (sec === null || sec < 0) return '—';
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
  }
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export function streamerInitial(name: string): string {
  return (name?.trim().charAt(0) ?? '?').toUpperCase();
}
