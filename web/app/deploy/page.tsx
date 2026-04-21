import DeployClient from './DeployClient';

export const dynamic = 'force-dynamic';

export default function DeployPage() {
  const tokenLive = process.env.NEXT_PUBLIC_TOKEN_LIVE === 'true';
  return <DeployClient tokenLive={tokenLive} />;
}
