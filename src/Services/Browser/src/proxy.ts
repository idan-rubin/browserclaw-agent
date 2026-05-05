import { anonymizeProxy, closeAnonymizedProxy } from 'proxy-chain';
import { logger } from './logger.js';

const COUNTRY = 'us';
const STICKY_LIFETIME = '30m';

const RESIDENTIAL_DOMAINS = (process.env.RESIDENTIAL_DOMAINS ?? '')
  .split(',')
  .map((d) => d.trim().toLowerCase())
  .filter((d) => d.length > 0);

interface ProxyConfig {
  host: string;
  port: string;
  user: string;
  pass: string;
}

function readConfig(): ProxyConfig | null {
  const host = process.env.IPROYAL_HOST;
  const port = process.env.IPROYAL_PORT;
  const user = process.env.IPROYAL_USERNAME;
  const pass = process.env.IPROYAL_PASSWORD;
  if (
    host === undefined ||
    port === undefined ||
    user === undefined ||
    pass === undefined ||
    host.length === 0 ||
    port.length === 0 ||
    user.length === 0 ||
    pass.length === 0
  ) {
    return null;
  }
  return { host, port, user, pass };
}

export function shouldUseResidentialProxy(prompt: string, url: string | undefined): boolean {
  if (readConfig() === null) return false;
  if (RESIDENTIAL_DOMAINS.length === 0) return false;
  const haystack = `${prompt.toLowerCase()} ${(url ?? '').toLowerCase()}`;
  return RESIDENTIAL_DOMAINS.some((d) => haystack.includes(d));
}

export interface SessionProxy {
  url: string;
  close: () => Promise<void>;
}

export async function startSessionProxy(sessionToken: string): Promise<SessionProxy> {
  const config = readConfig();
  if (config === null) {
    throw new Error('Residential proxy requested but IPROYAL_* env vars are not set');
  }
  const stickyPass = `${config.pass}_country-${COUNTRY}_session-${sessionToken}_lifetime-${STICKY_LIFETIME}`;
  const upstreamUrl = `http://${encodeURIComponent(config.user)}:${encodeURIComponent(stickyPass)}@${config.host}:${config.port}`;
  const localUrl = await anonymizeProxy(upstreamUrl);
  logger.info({ sessionToken, localUrl, country: COUNTRY, upstreamHost: config.host }, 'Started residential proxy');
  return {
    url: localUrl,
    close: async () => {
      try {
        await closeAnonymizedProxy(localUrl, true);
      } catch (err) {
        logger.error({ sessionToken, err }, 'Failed to close residential proxy');
      }
    },
  };
}
