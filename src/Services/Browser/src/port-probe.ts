import { createServer } from 'node:net';

/**
 * Probe whether a TCP port on 127.0.0.1 is free to bind. Used by the CDP
 * port allocator to detect when its in-memory session map has gone stale
 * (Chrome died without closeSession() being called) — the physical port
 * is free but the map still claims it.
 */
export function isPortFree(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const server = createServer();
    server.once('error', () => {
      resolve(false);
    });
    server.once('listening', () => {
      server.close(() => {
        resolve(true);
      });
    });
    server.listen(port, '127.0.0.1');
  });
}
