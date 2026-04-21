import type { FastifyInstance } from 'fastify';
import { SESSION_LENGTH_MS } from '@gleamers/shared';
import type { SessionType, StreamerStatus } from '@gleamers/shared';

import { getSupabase } from '../supabase.js';
import { requireApiKey } from '../auth.js';
import {
  activeWorkers,
  getWorker,
  registerWorker,
  removeWorker,
  spawnWorker,
  stopWorker,
} from '../workers.js';
import { finalizeSession } from '../sessions.js';
import { getRedis, SPEAKING_KEY } from '../redis.js';

interface StartBody {
  sessionType?: SessionType;
}

interface StopBody {
  reason?: 'platform_stop' | 'timer' | 'crash' | 'revival_timer';
}

const ALLOWED_STATUS_BY_TYPE: Record<SessionType, StreamerStatus> = {
  debut: 'OFFLINE',
  normal: 'READY',
  revival: 'COOLING_DOWN',
};

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

      if (getWorker(slug)) {
        reply.code(409).send({ error: 'already running', slug });
        return;
      }

      const sb = getSupabase();
      const { data: streamer, error } = await sb
        .from('streamers')
        .select('*')
        .eq('slug', slug)
        .maybeSingle();
      if (error) throw error;
      if (!streamer) {
        reply.code(404).send({ error: 'streamer not found' });
        return;
      }

      const expected = ALLOWED_STATUS_BY_TYPE[sessionType];
      if (streamer.status !== expected) {
        reply.code(409).send({
          error: `cannot start ${sessionType}: streamer is ${streamer.status}, expected ${expected}`,
        });
        return;
      }

      // Revival has per-streamer 24h cap
      if (sessionType === 'revival') {
        const resetAt = streamer.revival_count_reset_at
          ? new Date(streamer.revival_count_reset_at)
          : null;
        const within24h =
          resetAt && Date.now() - resetAt.getTime() <= 24 * 60 * 60 * 1000;
        const count = within24h ? streamer.revival_count_today : 0;
        if (count >= 1) {
          reply
            .code(409)
            .send({ error: 'revival cap reached (1 per 24h)' });
          return;
        }
      }

      const now = new Date();
      const endsAt = new Date(now.getTime() + SESSION_LENGTH_MS);

      const { data: session, error: sessErr } = await sb
        .from('sessions')
        .insert({
          streamer_id: streamer.id,
          scheduled_end_at: endsAt.toISOString(),
          session_type: sessionType,
        })
        .select('*')
        .single();
      if (sessErr || !session) {
        throw sessErr ?? new Error('session insert failed');
      }

      const { error: upErr } = await sb
        .from('streamers')
        .update({
          status: 'LIVE',
          current_session_id: session.id,
          last_active_at: now.toISOString(),
        })
        .eq('id', streamer.id);
      if (upErr) throw upErr;

      let spawned;
      try {
        spawned = spawnWorker({
          slug,
          sessionId: session.id,
          sessionType,
        });
      } catch (err) {
        // Roll back the sessions row + streamer on spawn failure
        await sb.from('sessions').delete().eq('id', session.id);
        await sb
          .from('streamers')
          .update({
            status: streamer.status,
            current_session_id: null,
          })
          .eq('id', streamer.id);
        throw err;
      }

      const handle = {
        slug,
        sessionId: session.id,
        sessionType,
        port: spawned.port,
        scheduledEndAt: endsAt,
        child: spawned.child,
        startedAt: now,
        viewers: new Set<string>(),
      };
      registerWorker(handle);

      spawned.child.once('exit', (code, signal) => {
        app.log.info(
          { slug, code, signal },
          '[orch] worker exited',
        );
        // lifecycle watcher will reconcile via DB snapshot
      });

      reply.send({
        sessionId: session.id,
        workerPort: spawned.port,
        endsAt: endsAt.toISOString(),
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
