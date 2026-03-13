import { BrowserClaw, type CrawlPage } from 'browserclaw';
import type { ServerResponse } from 'node:http';
import { HttpError } from './types.js';
import type { Session, SessionStatus, AgentLoopResult, SkillOutput, CatalogSkill } from './types.js';
import { runAgentLoop } from './agent-loop.js';
import { generateSkill, generateSkillTags } from './skill-generator.js';
import { moderatePrompt } from './content-policy.js';
import { logPrompt } from './prompt-log.js';
import { requireEnvInt, USER_RESPONSE_TIMEOUT_MS } from './config.js';
import { getLLMCallCount, resetLLMCallCount } from './llm.js';
import { extractDomain, getSkillForDomain, saveSkill } from './skill-store.js';

interface ManagedSession {
  id: string;
  prompt: string;
  ip: string;
  browser: BrowserClaw;
  page: CrawlPage;
  cdpPort: number;
  status: SessionStatus;
  createdAt: Date;
  lastActivityAt: Date;
  sseClients: Set<ServerResponse>;
  domain: string | null;
  result: AgentLoopResult | null;
  skill: SkillOutput | null;
  abortController: AbortController;
  pendingUserResponse: {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null;
}

const MAX_SESSIONS = requireEnvInt('MAX_SESSIONS', 10);
const SESSION_IDLE_TIMEOUT_MS = requireEnvInt('SESSION_IDLE_TIMEOUT_MS', 900_000);
const SESSION_MAX_DURATION_MS = requireEnvInt('SESSION_MAX_DURATION_MS', 300_000);
const BASE_CDP_PORT = 9222;
const MIN_STEPS_FOR_SKILL = 3;
const AUTO_CLOSE_DELAY_MS = 10_000;
const NON_ACTION_TYPES = new Set(['done', 'wait', 'fail', 'ask_user']);

const sessions = new Map<string, ManagedSession>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

function nextAvailableCdpPort(): number {
  const usedPorts = new Set([...sessions.values()].map(s => s.cdpPort));
  let port = BASE_CDP_PORT;
  while (usedPorts.has(port)) port++;
  return port;
}

function getManagedSession(sessionId: string): ManagedSession {
  const session = sessions.get(sessionId);
  if (!session) throw new HttpError(404, `Session ${sessionId} not found`);
  return session;
}

export function emitSSE(sessionId: string, event: string, data: unknown): void {
  const managed = sessions.get(sessionId);
  if (!managed) return;
  const payload = `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`;
  for (const client of managed.sseClients) {
    client.write(payload);
  }
}

export function addSSEClient(sessionId: string, res: ServerResponse): void {
  const managed = getManagedSession(sessionId);
  managed.sseClients.add(res);
  res.on('close', () => {
    managed.sseClients.delete(res);
    if (managed.sseClients.size === 0 && managed.status === 'running') {
      setTimeout(async () => {
        const current = sessions.get(sessionId);
        if (current && current.sseClients.size === 0 && current.status === 'running') {
          console.log(`Closing session ${sessionId} — all clients disconnected`);
          await closeSession(sessionId);
        }
      }, 5_000);
    }
  });
}

export function startCleanupLoop(): void {
  cleanupInterval = setInterval(async () => {
    const now = Date.now();
    for (const [id, session] of sessions) {
      const age = now - session.createdAt.getTime();
      const idle = now - session.lastActivityAt.getTime();
      if (age > SESSION_MAX_DURATION_MS) {
        console.log(`Closing session ${id} — exceeded max duration (${Math.round(age / 1000)}s)`);
        emitSSE(id, 'timeout', { reason: 'Session time limit reached (5 minutes)' });
        await closeSession(id);
      } else if (idle > SESSION_IDLE_TIMEOUT_MS && session.status !== 'waiting_for_user') {
        console.log(`Closing idle session ${id}`);
        await closeSession(id);
      }
    }
  }, 5_000);
}

export function stopCleanupLoop(): void {
  if (cleanupInterval) clearInterval(cleanupInterval);
}

export async function createSession(
  prompt: string,
  url: string | undefined,
  headless: boolean | undefined,
  ip: string,
  skipModeration?: boolean,
): Promise<{ session: Session }> {
  if (sessions.size >= MAX_SESSIONS) {
    throw new HttpError(429, `Maximum concurrent sessions (${MAX_SESSIONS}) reached`);
  }

  const existingSessions = [...sessions.values()].filter(s => s.ip === ip);
  for (const existing of existingSessions) {
    console.log(`Closing existing session ${existing.id} for IP ${ip} — new session requested`);
    await closeSession(existing.id);
  }

  if (!skipModeration) {
    const aiCheck = await moderatePrompt(prompt);
    if (!aiCheck.allowed) {
      throw new HttpError(422, aiCheck.reason ?? 'Prompt blocked by content policy.');
    }
  }

  const cdpPort = nextAvailableCdpPort();

  const browser = await BrowserClaw.launch({
    headless,
    noSandbox: process.platform === 'linux',
    cdpPort,
    ssrfPolicy: {
      dangerouslyAllowPrivateNetwork: process.env.SSRF_ALLOW_PRIVATE === 'true',
    },
    chromeArgs: [
      '--disable-blink-features=AutomationControlled',
      '--disable-downloads',
      '--disable-file-system',
      ...(headless ? [] : ['--start-maximized']),
    ],
  });

  let page: CrawlPage;
  try {
    page = await browser.currentPage();
    if (url) await page.goto(url);
  } catch (err) {
    console.error(`Failed to open URL ${url} — stopping orphaned Chrome:`, err);
    await browser.stop().catch((stopErr) => {
      console.error(`Failed to stop orphaned Chrome for ${url}:`, stopErr);
    });
    throw err;
  }

  const now = new Date();
  const id = crypto.randomUUID().replace(/-/g, '');

  const managed: ManagedSession = {
    id,
    prompt,
    ip,
    browser,
    page,
    cdpPort,
    status: 'pending',
    createdAt: now,
    lastActivityAt: now,
    sseClients: new Set(),
    domain: url ? extractDomain(url) : null,
    result: null,
    skill: null,
    abortController: new AbortController(),
    pendingUserResponse: null,
  };

  sessions.set(id, managed);
  console.log(`Created session ${id} (CDP port ${cdpPort})`);

  logPrompt({
    timestamp: now.toISOString(),
    session_id: id,
    ip,
    prompt,
    url,
    status: 'started',
  });

  startAgentLoop(id).catch((err) => {
    console.error(`Agent loop failed for session ${id}:`, err);
  });

  return {
    session: {
      id,
      prompt,
      created_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      status: 'pending',
      max_duration_ms: SESSION_MAX_DURATION_MS,
    },
  };
}

async function startAgentLoop(sessionId: string): Promise<void> {
  const managed = getManagedSession(sessionId);
  managed.status = 'running';

  const emitter = (event: string, data: unknown) => {
    managed.lastActivityAt = new Date();
    emitSSE(sessionId, event, data);
  };

  let skillsLoadedCount = 0;
  let skillOutcome: 'saved' | 'improved' | 'validated' | 'none' = 'none';

  try {
    // Fetch domain skill if we have a domain
    let domainSkill: CatalogSkill | null = null;
    if (managed.domain) {
      try {
        const fetchStart = Date.now();
        domainSkill = await getSkillForDomain(managed.domain);
        const fetchMs = Date.now() - fetchStart;
        if (domainSkill) {
          skillsLoadedCount = 1;
          console.log(`Found skill for ${managed.domain} (${fetchMs}ms): "${domainSkill.skill.title}"`);
          emitter('skills_loaded', {
            domain: managed.domain,
            title: domainSkill.skill.title,
            run_count: domainSkill.run_count,
            fetch_ms: fetchMs,
          });
        }
      } catch (err) {
        console.error(`Failed to fetch skill for ${managed.domain}:`, err instanceof Error ? err.message : err);
      }
    }

    resetLLMCallCount();
    const waitForUser = () => waitForUserResponse(sessionId);
    const result = await runAgentLoop(
      managed.prompt,
      managed.page,
      emitter,
      managed.abortController.signal,
      waitForUser,
      managed.browser,
      domainSkill,
    );
    const llmCalls = getLLMCallCount();

    managed.result = result;
    managed.status = result.success ? 'completed' : 'failed';

    // Capture domain from first navigate action if not set
    if (!managed.domain) {
      const nav = result.steps.find(s => s.action.action === 'navigate' && s.action.url);
      if (nav?.action.url) {
        managed.domain = extractDomain(nav.action.url);
      } else if (result.final_url) {
        managed.domain = extractDomain(result.final_url);
      }
    }

    if (result.success) {
      skillOutcome = await tryGenerateSkill(managed, emitter, domainSkill);
      emitter('completed', {
        steps_completed: result.steps.length,
        duration_ms: result.duration_ms,
        llm_calls: llmCalls,
        answer: result.answer,
        domain: managed.domain,
        skills_used: skillsLoadedCount > 0,
        skills_loaded: skillsLoadedCount,
        skill_outcome: skillOutcome,
      });
    } else {
      emitter('failed', {
        step: result.steps.length,
        error: result.error,
        llm_calls: llmCalls,
      });
    }

    logPrompt({
      timestamp: new Date().toISOString(),
      session_id: sessionId,
      ip: managed.ip,
      prompt: managed.prompt,
      url: result.final_url ?? '',
      status: result.success ? 'completed' : 'failed',
      steps: result.steps.length,
      duration_ms: result.duration_ms,
      error: result.error,
      domain: managed.domain ?? undefined,
      skills_loaded: skillsLoadedCount,
      skill_outcome: skillOutcome,
    });
  } catch (err) {
    managed.status = 'failed';
    const message = err instanceof Error ? err.message : 'Agent loop crashed';
    console.error(`Agent loop crashed for session ${sessionId}:`, message);
    emitter('failed', { step: 0, error: message });
  }

  setTimeout(() => {
    closeSession(sessionId).catch((err) => {
      console.error(`Auto-close failed for session ${sessionId}:`, err);
    });
  }, AUTO_CLOSE_DELAY_MS);
}

async function tryGenerateSkill(
  managed: ManagedSession,
  emitter: (event: string, data: unknown) => void,
  existing: CatalogSkill | null,
): Promise<'saved' | 'improved' | 'validated' | 'none'> {
  const result = managed.result;
  if (!result) return 'none';

  const actionSteps = result.steps.filter(s => !NON_ACTION_TYPES.has(s.action.action));
  if (actionSteps.length < MIN_STEPS_FOR_SKILL) return 'none';

  try {
    const skill = await generateSkill(managed.prompt, result);
    managed.skill = skill;
    emitter('skill_generated', { skill });

    if (managed.domain) {
      try {
        const tags = await generateSkillTags(managed.prompt, skill);

        if (existing) {
          const oldSteps = existing.skill.steps.length;
          const newSteps = skill.steps.length;

          if (newSteps < oldSteps) {
            await saveSkill(managed.domain, skill, tags);
            console.log(`Skill improved for ${managed.domain}: ${oldSteps} steps → ${newSteps} steps`);
            emitter('skill_improved', {
              domain: managed.domain,
              title: skill.title,
              previous_steps: oldSteps,
              new_steps: newSteps,
            });
            return 'improved';
          } else {
            const runCount = (existing.run_count ?? 1) + 1;
            await saveSkill(managed.domain, existing.skill, existing.tags, runCount);
            console.log(`Skill validated for ${managed.domain}: "${existing.skill.title}" (run #${runCount})`);
            emitter('skill_validated', {
              domain: managed.domain,
              title: existing.skill.title,
              steps: oldSteps,
              run_count: runCount,
            });
            return 'validated';
          }
        } else {
          await saveSkill(managed.domain, skill, tags);
          emitter('skill_saved', { domain: managed.domain, title: skill.title, tags });
          return 'saved';
        }
      } catch (err) {
        console.error(`Failed to save skill for ${managed.domain}:`, err instanceof Error ? err.message : err);
      }
    }
    return 'saved';
  } catch (err) {
    console.error(`Skill generation failed for session ${managed.id}:`, err);
    return 'none';
  }
}

export function getSession(sessionId: string): Session {
  const managed = getManagedSession(sessionId);
  return {
    id: managed.id,
    prompt: managed.prompt,
    created_at: managed.createdAt.toISOString(),
    last_activity_at: managed.lastActivityAt.toISOString(),
    status: managed.status,
  };
}

export function getSessionResult(sessionId: string): { result: AgentLoopResult | null; skill: SkillOutput | null } {
  const managed = getManagedSession(sessionId);
  return { result: managed.result, skill: managed.skill };
}

export function waitForUserResponse(sessionId: string): Promise<string> {
  const managed = getManagedSession(sessionId);
  managed.status = 'waiting_for_user';

  return new Promise<string>((resolve, reject) => {
    const timeout = setTimeout(() => {
      managed.pendingUserResponse = null;
      managed.status = 'running';
      reject(new Error('User response timed out'));
    }, USER_RESPONSE_TIMEOUT_MS);

    managed.pendingUserResponse = {
      resolve: (text: string) => {
        clearTimeout(timeout);
        managed.pendingUserResponse = null;
        managed.status = 'running';
        managed.lastActivityAt = new Date();
        resolve(text);
      },
      reject: (err: Error) => {
        clearTimeout(timeout);
        managed.pendingUserResponse = null;
        managed.status = 'running';
        reject(err);
      },
    };
  });
}

export function resolveUserResponse(sessionId: string, text: string): void {
  const managed = getManagedSession(sessionId);
  if (!managed.pendingUserResponse) {
    throw new HttpError(409, 'Session is not waiting for user input');
  }
  managed.pendingUserResponse.resolve(text);
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.pendingUserResponse) {
    session.pendingUserResponse.reject(new Error('Session closed'));
  }
  session.abortController.abort();
  sessions.delete(sessionId);

  for (const client of session.sseClients) {
    client.end();
  }

  try {
    await session.browser.stop();
  } catch (err) {
    console.error(`Failed to stop browser for session ${sessionId}:`, err);
  }
  console.log(`Closed session ${sessionId}`);
}

export async function closeAllSessions(): Promise<void> {
  for (const id of sessions.keys()) {
    await closeSession(id);
  }
}

export function sessionCount(): number {
  return sessions.size;
}
