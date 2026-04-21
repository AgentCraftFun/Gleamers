import type { FastifyInstance } from 'fastify';
import type { SessionType } from '@gleamers/shared';

import { getSupabase } from '../supabase.js';
import { requireApiKey } from '../auth.js';
import {
  activeWorkers,
  getWorker,
  removeWorker,
  stopWorker,
} from '../workers.js';
import { finalizeSession } from '../sessions.js';
import { getRedis, SPEAKING_KEY } from '../redis.js';
import { startStreamerSession } from '../startSession.js';

interface StartBody {
  sessionType?: SessionType;
}

interface StopBody {
  reason?: 'platform_stop' | 'timer' | 'crash' | 'revival_timer';
}

export async function registerStreamerRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------
  // POST /streamers/:slug/start — protected
  // -------------------------------------------------------------------
  app.post<{ Params: { slug: string }; Body: StartBody }>(
    '/streamers/:slug/start',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const { slug } = req.params;
      const sessionType = req.body?.sessionType ?? 'normal';

      const result = await startStreamerSession(slug, sessionType, {
        onExit: (code, signal) =>
          app.log.info({ slug, code, signal }, '[orch] worker exited'),
      });
      if (!result.ok) {
        switch (result.error.kind) {
          case 'already_running':
            reply.code(409).send({ error: 'already running', slug });
            return;
          case 'not_found':
            reply.code(404).send({ error: 'streamer not found' });
            return;
          case 'status_mismatch':
            reply.code(409).send({
              error: `cannot start ${sessionType}: streamer is ${result.error.current}, expected ${result.error.expected}`,
            });
            return;
          case 'revival_cap_reached':
            reply.code(409).send({ error: 'revival cap reached (1 per 24h)' });
            return;
          case 'db_error':
            reply
              .code(500)
              .send({ error: 'db_error', detail: result.error.message });
            return;
          case 'spawn_error':
            reply
              .code(502)
              .send({ error: 'spawn_error', detail: result.error.message });
            return;
        }
      }

      reply.send({
        sessionId: result.value.sessionId,
        workerPort: result.value.workerPort,
        endsAt: result.value.endsAt.toISOString(),
      });
    },
  );

  // -------------------------------------------------------------------
  // POST /streamers/:slug/stop — protected
  // -------------------------------------------------------------------
  app.post<{ Params: { slug: string }; Body: StopBody }>(
    '/streamers/:slug/stop',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const { slug } = req.params;
      const reason = req.body?.reason ?? 'platform_stop';
      const handle = getWorker(slug);
      if (!handle) {
        reply.code(404).send({ error: 'not running' });
        return;
      }

      await stopWorker(handle);

      const sb = getSupabase();
      const { data: streamer } = await sb
        .from('streamers')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (streamer) {
        await finalizeSession({
          sessionId: handle.sessionId,
          endedAt: new Date(),
          endReason: reason,
          streamer,
          sessionType: handle.sessionType,
        });
      }

      removeWorker(slug);
      reply.send({ stopped: true, slug });
    },
  );

  // -------------------------------------------------------------------
  // GET /streamers/:slug/ws-info — public
  // -------------------------------------------------------------------
  app.get<{ Params: { slug: string } }>(
    '/streamers/:slug/ws-info',
    async (req, reply) => {
      const { slug } = req.params;
      const handle = getWorker(slug);
      if (!handle) {
        reply.code(404).send({ error: 'not live', slug });
        return;
      }
      reply.send({
        workerPort: handle.port,
        sessionId: handle.sessionId,
        sessionType: handle.sessionType,
        endsAt: handle.scheduledEndAt.toISOString(),
      });
    },
  );

  // -------------------------------------------------------------------
  // GET /streamers/active — public
  // -------------------------------------------------------------------
  app.get('/streamers/active', async () => {
    const now = Date.now();
    return activeWorkers().map((h) => ({
      slug: h.slug,
      sessionId: h.sessionId,
      sessionType: h.sessionType,
      viewers: h.viewers.size,
      secondsRemaining: Math.max(
        0,
        Math.floor((h.scheduledEndAt.getTime() - now) / 1000),
      ),
    }));
  });

  // -------------------------------------------------------------------
  // GET /streamers/viewer-counts — public
  // -------------------------------------------------------------------
  app.get('/streamers/viewer-counts', async () => {
    const out: Record<string, number> = {};
    for (const h of activeWorkers()) {
      out[h.slug] = h.viewers.size;
    }
    return out;
  });

  // -------------------------------------------------------------------
  // GET /streamers/speaking-status — public
  // -------------------------------------------------------------------
  app.get('/streamers/speaking-status', async () => {
    const redis = getRedis();
    if (!redis) return {};
    try {
      const hash = await redis.hgetall(SPEAKING_KEY);
      const out: Record<string, boolean> = {};
      for (const [slug, value] of Object.entries(hash)) {
        if (getWorker(slug)) {
          out[slug] = value === 'true' || value === '1';
        }
      }
      return out;
    } catch (err) {
      app.log.warn({ err }, '[orch] speaking-status redis read failed');
      return {};
    }
  });
}
