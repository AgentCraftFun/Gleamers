/**
 * Bidirectional WS reverse proxy at /ws/:slug.
 *
 * We use the native Node http `upgrade` event against Fastify's
 * underlying server so we don't need @fastify/websocket. The proxy:
 *  - looks up the worker by slug
 *  - if missing, closes with code 1011 (server error / not found)
 *  - opens an upstream WS to ws://127.0.0.1:<workerPort>
 *  - pipes binary/text frames both ways
 *  - tracks per-slug viewer counts in the WorkerHandle
 */
import { randomUUID } from 'node:crypto';
import type { IncomingMessage, Server } from 'node:http';
import type { Socket } from 'node:net';
import { WebSocket, WebSocketServer } from 'ws';

import { getWorker } from './workers.js';

const PROXY_PATH_RE = /^\/ws\/([^/?#]+)/;

function closeSocketWithCode(
  socket: Socket,
  code: number,
  reason: string,
): void {
  try {
    // Minimal HTTP/1.1 error response when the upgrade hasn't happened yet.
    socket.write(
      `HTTP/1.1 ${code} ${reason}\r\nConnection: close\r\n\r\n`,
    );
  } catch {
    /* noop */
  }
  socket.destroy();
}

export function attachWsProxy(server: Server): void {
  // We keep a lightweight WSServer with noServer:true so we can call
  // handleUpgrade() manually after we've resolved the backend.
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req: IncomingMessage, socket: Socket, head) => {
    const match = (req.url ?? '').match(PROXY_PATH_RE);
    if (!match) {
      // Not a WS route we care about — let other handlers respond.
      return;
    }
    const slug = decodeURIComponent(match[1]!);
    const handle = getWorker(slug);
    if (!handle) {
      closeSocketWithCode(socket, 404, 'Not Found');
      return;
    }

    wss.handleUpgrade(req, socket, head, (client) => {
      const viewerId = randomUUID();
      handle.viewers.add(viewerId);

      const upstream = new WebSocket(
        `ws://127.0.0.1:${handle.port}`,
        { perMessageDeflate: false },
      );
      let upstreamOpen = false;
      const pending: Array<Buffer> = [];

      const forwardToClient = (data: WebSocket.RawData, isBinary: boolean) => {
        if (client.readyState === WebSocket.OPEN) {
          client.send(data, { binary: isBinary });
        }
      };

      const forwardToUpstream = (data: WebSocket.RawData, isBinary: boolean) => {
        const buf = Buffer.isBuffer(data)
          ? data
          : Array.isArray(data)
            ? Buffer.concat(data)
            : Buffer.from(data as ArrayBuffer);
        if (!upstreamOpen) {
          pending.push(buf);
          return;
        }
        upstream.send(buf, { binary: isBinary });
      };

      upstream.on('open', () => {
        upstreamOpen = true;
        for (const buf of pending) upstream.send(buf);
        pending.length = 0;
      });
      upstream.on('message', forwardToClient);
      upstream.on('close', (code, reason) => {
        try {
          client.close(code, reason);
        } catch {
          /* noop */
        }
        handle.viewers.delete(viewerId);
      });
      upstream.on('error', (err) => {
        console.warn(
          `[orch] upstream WS error slug=${slug} port=${handle.port}:`,
          err.message,
        );
        try {
          client.close(1011, 'upstream error');
        } catch {
          /* noop */
        }
        handle.viewers.delete(viewerId);
      });

      client.on('message', forwardToUpstream);
      client.on('close', () => {
        try {
          upstream.close();
        } catch {
          /* noop */
        }
        handle.viewers.delete(viewerId);
      });
      client.on('error', (err) => {
        console.warn(`[orch] client WS error slug=${slug}:`, err.message);
        handle.viewers.delete(viewerId);
      });
    });
  });
}
