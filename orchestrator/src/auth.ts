import type { FastifyReply, FastifyRequest } from 'fastify';

/**
 * Require the X-API-Key header to match ORCHESTRATOR_API_KEY. If the
 * env is unset, the guard fails closed (all protected routes return
 * 401). Set ORCHESTRATOR_API_KEY explicitly to enable writes.
 */
export async function requireApiKey(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<void> {
  const expected = process.env.ORCHESTRATOR_API_KEY;
  if (!expected) {
    reply.code(503).send({ error: 'ORCHESTRATOR_API_KEY not configured' });
    return;
  }
  const got = req.headers['x-api-key'];
  if (got !== expected) {
    reply.code(401).send({ error: 'unauthorized' });
    return;
  }
}
