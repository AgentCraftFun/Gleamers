import Fastify from 'fastify';

import { registerStreamerRoutes } from './routes/streamers.js';
import { attachWsProxy } from './wsProxy.js';
import {
  REVIVAL_CHECK_INTERVAL_MS,
  REVIVAL_ENABLED,
  REVIVAL_MAX_PER_DAY_PER_STREAMER,
  REVIVAL_MIN_LIVE_THRESHOLD,
  cooldownResolver,
  lifecycleSweep,
  revivalCheck,
  startupReconcile,
} from './tasks.js';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  service: 'orchestrator',
  status: 'ok',
  tokenLive: process.env.TOKEN_LIVE === 'true',
  uptime: process.uptime(),
  revival: {
    enabled: REVIVAL_ENABLED,
    minLive: REVIVAL_MIN_LIVE_THRESHOLD,
    perDay: REVIVAL_MAX_PER_DAY_PER_STREAMER,
    intervalMs: REVIVAL_CHECK_INTERVAL_MS,
  },
}));

await registerStreamerRoutes(app);

async function start() {
  // Fastify.ready() wires everything up before we grab the raw server.
  await app.ready();
  attachWsProxy(app.server);

  const addr = await app.listen({ port: PORT, host: HOST });
  app.log.info(`orchestrator listening on ${addr}`);

  // Startup reconciliation (best-effort; don't block boot on DB flakiness).
  startupReconcile().catch((err) =>
    app.log.error({ err }, 'startupReconcile failed'),
  );

  const lifecycleTimer = setInterval(() => {
    lifecycleSweep().catch((err) =>
      app.log.error({ err }, 'lifecycleSweep failed'),
    );
  }, 30_000);

  const cooldownTimer = setInterval(() => {
    cooldownResolver().catch((err) =>
      app.log.error({ err }, 'cooldownResolver failed'),
    );
  }, 60_000);

  let revivalTimer: NodeJS.Timeout | null = null;
  if (REVIVAL_ENABLED) {
    revivalTimer = setInterval(() => {
      revivalCheck().catch((err) =>
        app.log.error({ err }, 'revivalCheck failed'),
      );
    }, REVIVAL_CHECK_INTERVAL_MS);
    app.log.info(
      `[orch] revival enabled: minLive=${REVIVAL_MIN_LIVE_THRESHOLD} perDay=${REVIVAL_MAX_PER_DAY_PER_STREAMER} every ${REVIVAL_CHECK_INTERVAL_MS}ms`,
    );
  } else {
    app.log.info('[orch] revival disabled (REVIVAL_ENABLED=false)');
  }

  const shutdown = async (signal: string) => {
    app.log.info(`[orch] received ${signal}, shutting down`);
    clearInterval(lifecycleTimer);
    clearInterval(cooldownTimer);
    if (revivalTimer) clearInterval(revivalTimer);
    try {
      await app.close();
    } finally {
      process.exit(0);
    }
  };
  process.on('SIGINT', () => void shutdown('SIGINT'));
  process.on('SIGTERM', () => void shutdown('SIGTERM'));
}

start().catch((err) => {
  app.log.error(err);
  process.exit(1);
});
