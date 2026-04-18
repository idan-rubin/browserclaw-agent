import { createServer, type IncomingMessage } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { handleRequest } from './routes.js';
import { startCleanupLoop, closeAllSessions, stopCleanupLoop } from './session-manager.js';
import { validateConfig } from './config.js';
import { initSkillStore } from './skill-store.js';
import { initLessonStore } from './lesson-store.js';
import { initTrajectoryStore } from './trajectory-store.js';
import { logger } from './logger.js';

const { port, rateLimitMax, rateLimitWindowMs, internalToken } = validateConfig();

const BEARER_PREFIX = 'Bearer ';

const ipHits = new Map<string, number[]>();

function getClientIP(req: IncomingMessage): string {
  // Last XFF entry only — leading entries are client-supplied and spoofable.
  const forwarded = req.headers['x-forwarded-for'];
  if (forwarded !== undefined) {
    const raw = Array.isArray(forwarded) ? forwarded[forwarded.length - 1] : forwarded;
    const entries = raw.split(',');
    const last = entries[entries.length - 1].trim();
    if (last !== '') return last;
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

const IP_HITS_MAX_ENTRIES = 10_000;

const ipCleanupInterval = setInterval(() => {
  if (ipHits.size > IP_HITS_MAX_ENTRIES) {
    ipHits.clear();
    return;
  }
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

initLessonStore();
initTrajectoryStore();
initSkillStore()
  .then(() => {
    server.listen(port, () => {
      logger.info({ port }, 'browserclaw-browser listening');
    });
  })
  .catch((err: unknown) => {
    logger.warn({ err }, 'Skill store unavailable — running without skill catalog');
    server.listen(port, () => {
      logger.info({ port }, 'browserclaw-browser listening');
    });
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

process.on('uncaughtException', (err) => {
  logger.error(
    { err: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err },
    'uncaughtException swallowed',
  );
});
process.on('unhandledRejection', (reason) => {
  logger.error(
    { reason: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : reason },
    'unhandledRejection swallowed',
  );
});
