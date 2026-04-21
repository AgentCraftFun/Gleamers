/**
 * Simple in-memory port pool for worker children.
 * Range 9000-9500. allocate() returns the lowest free port.
 */
const MIN = 9000;
const MAX = 9500;

const inUse = new Set<number>();

export function allocatePort(): number {
  for (let port = MIN; port <= MAX; port++) {
    if (!inUse.has(port)) {
      inUse.add(port);
      return port;
    }
  }
  throw new Error('Port pool exhausted');
}

export function releasePort(port: number): void {
  inUse.delete(port);
}

export function activePorts(): number[] {
  return [...inUse].sort((a, b) => a - b);
}
