import { spawn, type ChildProcess } from 'node:child_process';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { SessionType } from '@gleamers/shared';

import { allocatePort, releasePort } from './ports.js';

export interface WorkerHandle {
  slug: string;
  sessionId: string;
  sessionType: SessionType;
  port: number;
  scheduledEndAt: Date;
  child: ChildProcess;
  startedAt: Date;
  viewers: Set<string>; // WS client ids (for proxy count)
}

/** Map slug -> WorkerHandle for currently-running sessions. */
const registry = new Map<string, WorkerHandle>();

export function getWorker(slug: string): WorkerHandle | undefined {
  return registry.get(slug);
}

export function activeWorkers(): WorkerHandle[] {
  return [...registry.values()];
}

export function registerWorker(handle: WorkerHandle): void {
  registry.set(handle.slug, handle);
}

export function removeWorker(slug: string): WorkerHandle | undefined {
  const h = registry.get(slug);
  if (h) {
    releasePort(h.port);
    registry.delete(slug);
  }
  return h;
}

// ---------------------------------------------------------------------------
// Spawn helpers
// ---------------------------------------------------------------------------

interface SpawnedWorker {
  child: ChildProcess;
  port: number;
}

export interface SpawnOptions {
  slug: string;
  sessionId: string;
  sessionType: SessionType;
}

/**
 * Resolve the command+args used to run a worker session.
 * Env overrides:
 *   WORKER_CMD     — executable (default: process.execPath)
 *   WORKER_ARGS    — JSON array of args (default: resolves built/source entry)
 *   WORKER_CWD     — working dir (default: worker package root)
 */
function resolveWorkerCommand(): { cmd: string; args: string[]; cwd: string } {
  const workerRoot =
    process.env.WORKER_CWD ?? resolve(process.cwd(), '../worker');
  const distPath = resolve(workerRoot, 'dist/session.js');
  const srcPath = resolve(workerRoot, 'src/session.ts');

  if (process.env.WORKER_CMD) {
    const args = process.env.WORKER_ARGS
      ? (JSON.parse(process.env.WORKER_ARGS) as string[])
      : [];
    return { cmd: process.env.WORKER_CMD, args, cwd: workerRoot };
  }

  if (existsSync(distPath)) {
    return { cmd: process.execPath, args: [distPath], cwd: workerRoot };
  }
  // Fall back to running TS through tsx (dev mode).
  return {
    cmd: process.execPath,
    args: ['--import', 'tsx', srcPath],
    cwd: workerRoot,
  };
}

export function spawnWorker(opts: SpawnOptions): SpawnedWorker {
  const port = allocatePort();
  const { cmd, args, cwd } = resolveWorkerCommand();

  const child = spawn(cmd, args, {
    cwd,
    env: {
      ...process.env,
      STREAMER_SLUG: opts.slug,
      SESSION_ID: opts.sessionId,
      SESSION_TYPE: opts.sessionType,
      WORKER_PORT: String(port),
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  });

  child.on('error', (err) => {
    console.error(`[orch] worker ${opts.slug} spawn error:`, err);
  });

  return { child, port };
}

export async function stopWorker(
  handle: WorkerHandle,
  timeoutMs = 5000,
): Promise<void> {
  if (handle.child.killed) return;
  handle.child.kill('SIGTERM');
  await new Promise<void>((resolveFn) => {
    const killer = setTimeout(() => {
      if (!handle.child.killed) handle.child.kill('SIGKILL');
      resolveFn();
    }, timeoutMs);
    handle.child.once('exit', () => {
      clearTimeout(killer);
      resolveFn();
    });
  });
}
