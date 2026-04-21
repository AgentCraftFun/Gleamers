import type { FastifyInstance } from 'fastify';

import { requireApiKey } from '../auth.js';
import { runPostProcess } from '../postProcess.js';

/**
 * POST /sessions/:id/post-process
 *
 * Worker calls this on session end. We 202 immediately and run the
 * Haiku-summary + Sonnet-lore pipeline in the background so the
 * worker can exit. Failures log — there's no retry queue for MVP.
 */
export async function registerSessionRoutes(app: FastifyInstance) {
  app.post<{ Params: { id: string } }>(
    '/sessions/:id/post-process',
    { preHandler: requireApiKey },
    async (req, reply) => {
      const { id } = req.params;
      reply.code(202).send({ accepted: true, sessionId: id });
      // Kick off in the next tick so the 202 flushes first.
      setImmediate(() => {
        runPostProcess(id).catch((err) =>
          app.log.error({ err, sessionId: id }, 'post-process failed'),
        );
      });
    },
  );
}
