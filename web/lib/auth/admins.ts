export function adminWallets(): Set<string> {
  const raw = process.env.ADMIN_WALLETS ?? '';
  return new Set(
    raw
      .split(',')
      .map((w) => w.trim().toLowerCase())
      .filter(Boolean),
  );
}

export function isAdminWallet(wallet: string): boolean {
  return adminWallets().has(wallet.toLowerCase());
}
