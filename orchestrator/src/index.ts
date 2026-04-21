import Fastify from 'fastify';

const PORT = Number(process.env.PORT ?? 4000);
const HOST = process.env.HOST ?? '0.0.0.0';

const app = Fastify({ logger: true });

app.get('/health', async () => ({
  service: 'orchestrator',
  status: 'ok',
  tokenLive: process.env.TOKEN_LIVE === 'true',
  uptime: process.uptime(),
}));

app
  .listen({ port: PORT, host: HOST })
  .then((addr) => app.log.info(`orchestrator listening on ${addr}`))
  .catch((err) => {
    app.log.error(err);
    process.exit(1);
  });
