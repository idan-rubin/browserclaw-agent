import { describe, it, expect } from 'vitest';
import { createServer, type Server } from 'node:net';
import { isPortFree } from '../port-probe.js';

function occupyPort(port: number): Promise<Server> {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => {
      resolve(server);
    });
  });
}

function closeServer(server: Server): Promise<void> {
  return new Promise((resolve) => {
    server.close(() => {
      resolve();
    });
  });
}

describe('isPortFree', () => {
  it('returns true for an unoccupied port', async () => {
    // Pick a high port unlikely to be used.
    expect(await isPortFree(54321)).toBe(true);
  });

  it('returns false for a port we are actively listening on', async () => {
    const server = await occupyPort(54322);
    try {
      expect(await isPortFree(54322)).toBe(false);
    } finally {
      await closeServer(server);
    }
  });

  it('returns true again after the occupier releases the port', async () => {
    const server = await occupyPort(54323);
    await closeServer(server);
    expect(await isPortFree(54323)).toBe(true);
  });
});
