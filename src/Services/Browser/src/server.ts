import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { handleRequest } from './routes.js';
import { startCleanupLoop, closeAllSessions, stopCleanupLoop } from './session-manager.js';
import { validateConfig } from './config.js';
import { initSkillStore } from './skill-store.js';
import { logger } from './logger.js';

const { port, rateLimitMax, rateLimitWindowMs, internalToken } = validateConfig();

const BEARER_PREFIX = 'Bearer ';

const ipHits = new Map<string, number[]>();

function getClientIP(req: IncomingMessage): string {
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded !== undefined) {
    const first = Array.isArray(forwarded) ? forwarded[0] : forwarded.split(',')[0];
    return first.trim();
  }
  return req.socket.remoteAddress ?? '127.0.0.1';
}

function checkAndRecordHit(ip: string): boolean {
  const now = Date.now();
  const hits = (ipHits.get(ip) ?? []).filter((t) => now - t < rateLimitWindowMs);
  if (hits.length >= rateLimitMax) {
    ipHits.set(ip, hits);
    return false;
  }
  hits.push(now);
  ipHits.set(ip, hits);
  return true;
}

const ipCleanupInterval = setInterval(() => {
  const now = Date.now();
  for (const [ip, hits] of ipHits) {
    const active = hits.filter((t) => now - t < rateLimitWindowMs);
    if (active.length === 0) ipHits.delete(ip);
    else ipHits.set(ip, active);
  }
}, 3600_000);

function tokensMatch(provided: string, expected: string): boolean {
  const providedBuf = Buffer.from(provided);
  const expectedBuf = Buffer.from(expected);
  if (providedBuf.length !== expectedBuf.length) return false;
  return timingSafeEqual(providedBuf, expectedBuf);
}

const server = createServer((req, res) => {
  void (async () => {
    const headerValue = req.headers['x-correlation-id'];
    const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;
    const correlationId = raw ?? crypto.randomUUID();
    res.setHeader('X-Correlation-Id', correlationId);

    if (req.url !== '/health') {
      const auth = req.headers.authorization ?? '';
      const token = auth.startsWith(BEARER_PREFIX) ? auth.slice(BEARER_PREFIX.length) : '';
      if (!tokensMatch(token, internalToken)) {
        res.writeHead(401, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ error_code: 'UNAUTHORIZED', message: 'Invalid or missing internal token' }));
        return;
      }
    }

    const ip = getClientIP(req);

    if (req.method === 'POST' && req.url?.startsWith('/api/v1/sessions') === true) {
      if (!checkAndRecordHit(ip)) {
        res.writeHead(429, { 'Content-Type': 'application/json' });
        res.end(
          JSON.stringify({
            error_code: 'RATE_LIMITED',
            message: `Maximum ${String(rateLimitMax)} runs per 24 hours. Try again later.`,
          }),
        );
        return;
      }
    }

    await handleRequest(req, res, ip);
  })();
});

startCleanupLoop();

initSkillStore()
  .then(() => {
    server.listen(port, () => {
      logger.info({ port }, 'browserclaw-browser listening');
    });
  })
  .catch((err: unknown) => {
    logger.fatal({ err }, 'Failed to initialize skill store');
    process.exit(1);
  });

async function shutdown(): Promise<void> {
  logger.info('Shutting down...');
  const forceExit = setTimeout(() => {
    logger.error('Graceful shutdown timed out, forcing exit');
    process.exit(1);
  }, 10_000);
  forceExit.unref();

  clearInterval(ipCleanupInterval);
  stopCleanupLoop();
  await closeAllSessions();
  server.close();
  process.exit(0);
}

process.on('SIGTERM', () => {
  void shutdown();
});
process.on('SIGINT', () => {
  void shutdown();
});
