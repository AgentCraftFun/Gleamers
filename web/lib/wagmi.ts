import { cookieStorage, createStorage } from 'wagmi';
import { base, baseSepolia } from 'wagmi/chains';
import { http } from 'viem';
import { getDefaultConfig } from '@rainbow-me/rainbowkit';

export { getChainId } from './chain';

function alchemyUrl(chainId: 8453 | 84532): string | undefined {
  const key = process.env.NEXT_PUBLIC_ALCHEMY_KEY;
  if (!key) return undefined;
  const slug = chainId === 8453 ? 'base-mainnet' : 'base-sepolia';
  return `https://${slug}.g.alchemy.com/v2/${key}`;
}

/**
 * RainbowKit-flavoured wagmi config. Uses the free public RPC as a
 * fallback and Alchemy when NEXT_PUBLIC_ALCHEMY_KEY is set.
 * `cookieStorage` + `ssr: true` makes the connector survive page
 * navigations without flickering.
 */
export const wagmiConfig = getDefaultConfig({
  appName: 'Gleamers',
  // getDefaultConfig accepts any string here. WalletConnect Cloud
  // project ID is only required if users pick WalletConnect in the
  // modal — RainbowKit surfaces a helpful error in that case.
  projectId:
    process.env.NEXT_PUBLIC_WALLETCONNECT_PROJECT_ID ?? 'gleamers-dev',
  chains: [base, baseSepolia],
  transports: {
    [base.id]: http(alchemyUrl(8453)),
    [baseSepolia.id]: http(alchemyUrl(84532)),
  },
  ssr: true,
  storage: createStorage({ storage: cookieStorage }),
});
