import { BrowserClaw, type CrawlPage } from 'browserclaw';
import type { ServerResponse } from 'node:http';
import { isPortFree } from './port-probe.js';
import { HttpError } from './types.js';
import type {
  Session,
  SessionStatus,
  AgentLoopResult,
  SkillOutput,
  CatalogSkill,
  DomainSkillEntry,
  LlmConfig,
  UserMessage,
} from './types.js';
import { runAgentLoop } from './agent-loop.js';
import { generateSkill, generateSkillTags, mergeSkills } from './skill-generator.js';
import { judgeRun } from './judge.js';
import { moderatePrompt } from './content-policy.js';
import { logPrompt } from './prompt-log.js';
import {
  requireEnvInt,
  USER_RESPONSE_TIMEOUT_MS,
  USER_INTERJECTION_ENABLED,
  MAX_INTERJECTIONS_PER_RUN,
  INTERJECTION_MIN_INTERVAL_MS,
} from './config.js';
import { getLLMCallCount, resetLLMCallCount, runWithLlmConfig } from './llm.js';
import { extractDomain, getSkillForDomain, getSkillsForDomains, saveSkill } from './skill-store.js';
import { saveLesson, extractDomainLessons } from './lesson-store.js';
import { logger } from './logger.js';

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
  skillTags: string[];
  domainSkills: DomainSkillEntry[];
  abortController: AbortController;
  llmConfig: LlmConfig | undefined;
  pendingUserResponse: {
    resolve: (text: string) => void;
    reject: (err: Error) => void;
  } | null;
  /** Queue of user messages delivered while the agent was NOT blocked on ask_user. Drained at the top of each agent step. */
  userMessageQueue: UserMessage[];
  /** Per-session random token used to wrap user-interjection content in the LLM prompt so it can't spoof system instructions. */
  interjectionNonce: string;
  /** Running count of accepted interjections on this session — enforces the hard cap. */
  interjectionsReceived: number;
  /** Timestamp of the last accepted interjection — enforces the min-interval rate limit. */
  lastInterjectionAt: Date | null;
}

const MAX_SESSIONS = requireEnvInt('MAX_SESSIONS');
const SESSION_IDLE_TIMEOUT_MS = requireEnvInt('SESSION_IDLE_TIMEOUT_MS');
const BASE_CDP_PORT = 9222;
const MIN_STEPS_FOR_SKILL = 3;
const MIN_STEPS_FOR_LESSON = 3;
const AUTO_CLOSE_DELAY_MS = 10_000;
const NON_ACTION_TYPES = new Set(['done', 'wait', 'fail', 'ask_user']);

const sessions = new Map<string, ManagedSession>();
let cleanupInterval: ReturnType<typeof setInterval> | null = null;

const CDP_PORT_SEARCH_LIMIT = 100;

async function nextAvailableCdpPort(): Promise<number> {
  for (let port = BASE_CDP_PORT; port < BASE_CDP_PORT + CDP_PORT_SEARCH_LIMIT; port++) {
    if (await isPortFree(port)) {
      // Purge any stale session entries claiming this port — their Chrome died silently.
      for (const [id, s] of sessions) {
        if (s.cdpPort === port) {
          logger.warn({ sessionId: id, port }, 'Evicting stale session — CDP port is actually free');
          sessions.delete(id);
        }
      }
      return port;
    }
  }
  throw new HttpError(503, 'No free CDP ports available');
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
      setTimeout(() => {
        const current = sessions.get(sessionId);
        if (current?.sseClients.size === 0 && current.status === 'running') {
          logger.info({ sessionId }, 'Closing session — all clients disconnected');
          void closeSession(sessionId);
        }
      }, 5_000);
    }
  });
}

export function startCleanupLoop(): void {
  cleanupInterval = setInterval(() => {
    const now = Date.now();
    const toClose: string[] = [];
    for (const [id, session] of sessions) {
      const idle = now - session.lastActivityAt.getTime();
      if (idle > SESSION_IDLE_TIMEOUT_MS && session.status !== 'waiting_for_user') {
        toClose.push(id);
      }
    }
    void (async () => {
      for (const id of toClose) {
        logger.info({ sessionId: id }, 'Closing idle session');
        await closeSession(id);
      }
    })();
  }, 5_000);
}

export function stopCleanupLoop(): void {
  if (cleanupInterval !== null) clearInterval(cleanupInterval);
}

export async function createSession(
  prompt: string,
  url: string | undefined,
  headless: boolean | undefined,
  ip: string,
  skipModeration?: boolean,
  llmConfig?: LlmConfig,
): Promise<{ session: Session }> {
  if (sessions.size >= MAX_SESSIONS) {
    throw new HttpError(429, `Maximum concurrent sessions (${String(MAX_SESSIONS)}) reached`);
  }

  const existingSessions = [...sessions.values()].filter((s) => s.ip === ip);
  for (const existing of existingSessions) {
    logger.info({ sessionId: existing.id, ip }, 'Closing existing session — new session requested');
    await closeSession(existing.id);
  }

  if (skipModeration !== true && llmConfig === undefined) {
    const aiCheck = await moderatePrompt(prompt);
    if (!aiCheck.allowed) {
      throw new HttpError(422, aiCheck.reason ?? 'Prompt blocked by content policy.');
    }
  }

  const cdpPort = await nextAvailableCdpPort();

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
      ...(headless === true ? [] : ['--start-maximized']),
    ],
  });

  let page: CrawlPage;
  try {
    page = await browser.currentPage();
    if (url !== undefined) await page.goto(url);
  } catch (err) {
    logger.error({ url, err }, 'Failed to open URL — stopping orphaned Chrome');
    await browser.stop().catch((stopErr: unknown) => {
      logger.error({ url, err: stopErr }, 'Failed to stop orphaned Chrome');
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
    domain: url !== undefined ? extractDomain(url) : null,
    result: null,
    skill: null,
    skillTags: [],
    domainSkills: [],
    abortController: new AbortController(),
    llmConfig,
    pendingUserResponse: null,
    userMessageQueue: [],
    interjectionNonce: crypto.randomUUID().replace(/-/g, ''),
    interjectionsReceived: 0,
    lastInterjectionAt: null,
  };

  sessions.set(id, managed);
  logger.info({ sessionId: id, cdpPort }, 'Created session');

  void logPrompt({
    timestamp: now.toISOString(),
    session_id: id,
    ip,
    prompt,
    url,
    status: 'started',
  });

  void startAgentLoop(id).catch((err: unknown) => {
    logger.error({ sessionId: id, err }, 'Agent loop failed');
  });

  return {
    session: {
      id,
      prompt,
      created_at: now.toISOString(),
      last_activity_at: now.toISOString(),
      status: 'pending',
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
  let skillOutcome: 'saved' | 'improved' | 'refined' | 'validated' | 'none' = 'none';

  try {
    // Fetch domain skill if we have a domain
    let domainSkill: CatalogSkill | null = null;
    if (managed.domain !== null) {
      try {
        const fetchStart = Date.now();
        domainSkill = await getSkillForDomain(managed.domain);
        const fetchMs = Date.now() - fetchStart;
        if (domainSkill) {
          skillsLoadedCount = 1;
          logger.info({ domain: managed.domain, fetchMs, title: domainSkill.skill.title }, 'Found domain skill');
          emitter('skills_loaded', {
            count: 1,
            domain: managed.domain,
            title: domainSkill.skill.title,
            run_count: domainSkill.run_count,
            fetch_ms: fetchMs,
          });
        }
      } catch (err) {
        logger.error({ domain: managed.domain, err }, 'Failed to fetch domain skill');
      }
    }

    // All LLM work (agent loop + skill gen + judging) runs inside the BYOK
    // config scope when the user provides their own key.
    const runAllLlmWork = async () => {
      resetLLMCallCount();
      const waitForUser = () => waitForUserResponse(sessionId);
      const pageHolder = { page: managed.page };
      const userChatHooks = USER_INTERJECTION_ENABLED
        ? { drainMessages: () => drainUserMessages(sessionId), nonce: managed.interjectionNonce }
        : undefined;
      const result = await runAgentLoop(
        managed.prompt,
        pageHolder,
        emitter,
        managed.abortController.signal,
        waitForUser,
        managed.browser,
        domainSkill,
        undefined,
        userChatHooks,
      );
      const llmCalls = getLLMCallCount();

      // Sync back the page reference in case the agent switched tabs
      managed.page = pageHolder.page;
      managed.result = result;
      managed.status = result.success ? 'completed' : 'failed';

      // Capture domain from first navigate action if not set
      if (managed.domain === null) {
        const nav = result.steps.find(
          (s) => s.action.action === 'navigate' && s.action.url !== undefined && s.action.url !== '',
        );
        if (nav?.action.url !== undefined && nav.action.url !== '') {
          managed.domain = extractDomain(nav.action.url);
        } else if (result.final_url !== undefined && result.final_url !== '') {
          managed.domain = extractDomain(result.final_url);
        }
      }

      // Save lessons from every run (both success and failure)
      if (result.steps.length >= MIN_STEPS_FOR_LESSON) {
        try {
          const domainLessons = extractDomainLessons(result.steps, result.success);
          if (domainLessons.length > 0) {
            await saveLesson(managed.prompt, domainLessons);
            logger.info(
              { prompt: managed.prompt, lessons: domainLessons.length, success: result.success },
              'Saved task lessons',
            );
          }
        } catch (err) {
          logger.error({ err }, 'Failed to save task lessons');
        }
      }

      if (result.success) {
        skillOutcome = await tryGenerateSkill(managed, emitter, domainSkill);
        await aggregateDomainSkills(managed, domainSkill, emitter);
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

      void logPrompt({
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
    };

    if (managed.llmConfig) {
      await runWithLlmConfig(managed.llmConfig, runAllLlmWork);
    } else {
      await runAllLlmWork();
    }
  } catch (err) {
    managed.status = 'failed';
    const message = err instanceof Error ? err.message : 'Agent loop crashed';
    logger.error({ sessionId, crashed: true }, 'Agent loop crashed');
    emitter('failed', { step: 0, error: message });
  }

  setTimeout(() => {
    closeSession(sessionId).catch((err: unknown) => {
      logger.error({ sessionId, err }, 'Auto-close failed');
    });
  }, AUTO_CLOSE_DELAY_MS);
}

async function aggregateDomainSkills(
  managed: ManagedSession,
  initialDomainSkill: CatalogSkill | null,
  emitter: (event: string, data: unknown) => void,
): Promise<void> {
  const result = managed.result;
  if (!result) return;

  // Collect all unique domains from step URLs + final URL
  const visitedDomains = new Set<string>();
  for (const step of result.steps) {
    if (step.url !== undefined && step.url !== '') {
      const d = extractDomain(step.url);
      if (d !== '') visitedDomains.add(d);
    }
    if (step.action.url !== undefined && step.action.url !== '') {
      const d = extractDomain(step.action.url);
      if (d !== '') visitedDomains.add(d);
    }
  }
  if (result.final_url !== undefined && result.final_url !== '') {
    const d = extractDomain(result.final_url);
    if (d !== '') visitedDomains.add(d);
  }
  if (managed.domain !== null) {
    visitedDomains.add(managed.domain);
  }

  if (visitedDomains.size === 0) return;

  const entries: DomainSkillEntry[] = [];

  // If we generated a skill this run, add it as 'generated'
  if (managed.domain !== null && managed.skill !== null) {
    entries.push({
      domain: managed.domain,
      skill: managed.skill,
      source: 'generated',
      tags: managed.skillTags,
      run_count: 1,
    });
    visitedDomains.delete(managed.domain);
  }

  // For the initial domain, if skill was loaded from catalog but NOT regenerated (e.g. validated),
  // add it as 'catalog'
  if (initialDomainSkill && !entries.some((e) => e.domain === initialDomainSkill.domain)) {
    entries.push({
      domain: initialDomainSkill.domain,
      skill: initialDomainSkill.skill,
      source: 'catalog',
      tags: initialDomainSkill.tags,
      run_count: initialDomainSkill.run_count,
    });
    visitedDomains.delete(initialDomainSkill.domain);
  }

  // Fetch catalog skills for remaining visited domains
  if (visitedDomains.size > 0) {
    try {
      const catalogSkills = await getSkillsForDomains([...visitedDomains]);
      for (const [domain, catalogSkill] of catalogSkills) {
        entries.push({
          domain,
          skill: catalogSkill.skill,
          source: 'catalog',
          tags: catalogSkill.tags,
          run_count: catalogSkill.run_count,
        });
      }
    } catch (err) {
      logger.error(
        { err: err instanceof Error ? err.message : err },
        'Failed to fetch catalog skills for visited domains',
      );
    }
  }

  managed.domainSkills = entries;

  if (entries.length > 0) {
    emitter('domain_skills', { skills: entries, count: entries.length });
  }
}

async function tryGenerateSkill(
  managed: ManagedSession,
  emitter: (event: string, data: unknown) => void,
  existing: CatalogSkill | null,
): Promise<'saved' | 'improved' | 'refined' | 'validated' | 'none'> {
  const result = managed.result;
  if (!result) return 'none';

  const actionSteps = result.steps.filter((s) => !NON_ACTION_TYPES.has(s.action.action));
  if (actionSteps.length < MIN_STEPS_FOR_SKILL) return 'none';

  // Judge the run before generating a skill — prevent bad runs from becoming skills
  const verdict = await judgeRun(managed.prompt, result);
  if (!verdict.success) {
    logger.info({ reasoning: verdict.reasoning }, 'Judge rejected run — skipping skill generation');
    emitter('judge_rejected', { reasoning: verdict.reasoning });

    // Save failure notes on existing skill so future runs know about this failure mode
    if (existing && managed.domain !== null) {
      try {
        const failureNotes = [...(existing.skill.failure_notes ?? [])];
        failureNotes.push(`[${new Date().toISOString().slice(0, 10)}] ${verdict.reasoning.slice(0, 200)}`);
        // Keep only the last 5 failure notes
        const trimmedNotes = failureNotes.slice(-5);
        const updatedSkill = { ...existing.skill, failure_notes: trimmedNotes };
        await saveSkill(managed.domain, updatedSkill, existing.tags, existing.run_count);
        logger.info({ domain: managed.domain, notes_count: trimmedNotes.length }, 'Saved failure notes on skill');
      } catch (err) {
        logger.warn({ err: err instanceof Error ? err.message : err }, 'Failed to save failure notes');
      }
    }
    return 'none';
  }

  try {
    const skill = await generateSkill(managed.prompt, result);
    managed.skill = skill;
    emitter('skill_generated', { skill });

    if (managed.domain !== null) {
      try {
        const tags = await generateSkillTags(managed.prompt, skill);
        managed.skillTags = tags;

        if (existing) {
          const oldSteps = existing.skill.steps.length;
          const newSteps = skill.steps.length;

          if (newSteps < oldSteps) {
            // Fewer steps — improved (more efficient)
            await saveSkill(managed.domain, skill, tags);
            logger.info({ domain: managed.domain, oldSteps, newSteps }, 'Skill improved');
            emitter('skill_improved', {
              domain: managed.domain,
              title: skill.title,
              previous_steps: oldSteps,
              new_steps: newSteps,
            });
            return 'improved';
          } else if (newSteps > oldSteps * 1.5) {
            // Significantly more steps — merge skills to incorporate new learnings
            const merged = await mergeSkills(existing.skill, managed.prompt, result);
            managed.skill = merged;
            await saveSkill(managed.domain, merged, tags);
            logger.info(
              { domain: managed.domain, oldSteps, newSteps, mergedSteps: merged.steps.length },
              'Skill refined',
            );
            emitter('skill_refined', {
              domain: managed.domain,
              title: merged.title,
              previous_steps: oldSteps,
              run_steps: newSteps,
              merged_steps: merged.steps.length,
              new_tips: merged.tips.length - existing.skill.tips.length,
            });
            return 'refined';
          } else {
            // Similar step count — validated
            const runCount = existing.run_count + 1;
            await saveSkill(managed.domain, existing.skill, existing.tags, runCount);
            logger.info({ domain: managed.domain, title: existing.skill.title, runCount }, 'Skill validated');
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
      } catch {
        logger.error({ domain: managed.domain, save_failed: true }, 'Failed to save skill');
      }
    }
    return 'none';
  } catch {
    logger.error({ sessionId: managed.id, skill_generation_failed: true }, 'Skill generation failed');
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

export function getSessionResult(sessionId: string): {
  result: AgentLoopResult | null;
  skill: SkillOutput | null;
  domain_skills: DomainSkillEntry[];
} {
  const managed = getManagedSession(sessionId);
  return { result: managed.result, skill: managed.skill, domain_skills: managed.domainSkills };
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

/**
 * Accept a user message. When the flag is off, preserves the legacy behavior —
 * only accepts replies while the agent is blocked on ask_user. When on, always
 * enqueues (subject to rate limit + hard cap); if the agent is blocked on
 * ask_user, additionally resolves the waiting promise so existing callers keep
 * working unchanged.
 */
export function enqueueUserMessage(sessionId: string, text: string): void {
  const managed = getManagedSession(sessionId);

  if (!USER_INTERJECTION_ENABLED) {
    if (managed.pendingUserResponse === null) {
      throw new HttpError(409, 'Session is not waiting for user input');
    }
    managed.pendingUserResponse.resolve(text);
    return;
  }

  // Direct reply to an ask_user: unblock the agent loop via the existing
  // `user_response` history path. Skip the interjection queue — otherwise the
  // same text is processed twice (once as the reply that unblocks the step,
  // again as a "USER INTERJECTION" injected into the next step's prompt).
  if (managed.pendingUserResponse !== null) {
    managed.lastActivityAt = new Date();
    managed.pendingUserResponse.resolve(text);
    return;
  }

  if (managed.interjectionsReceived >= MAX_INTERJECTIONS_PER_RUN) {
    throw new HttpError(429, `Too many messages (cap: ${String(MAX_INTERJECTIONS_PER_RUN)} per run)`);
  }
  if (managed.lastInterjectionAt !== null) {
    const elapsed = Date.now() - managed.lastInterjectionAt.getTime();
    if (elapsed < INTERJECTION_MIN_INTERVAL_MS) {
      throw new HttpError(
        429,
        `Rate limit — wait ${String(Math.ceil((INTERJECTION_MIN_INTERVAL_MS - elapsed) / 1000))}s before sending again`,
      );
    }
  }

  const now = new Date();
  managed.userMessageQueue.push({ text, receivedAt: now });
  managed.interjectionsReceived += 1;
  managed.lastInterjectionAt = now;
  managed.lastActivityAt = now;
}

/**
 * Drain and return all pending user messages. Called by the agent loop at the
 * top of each step.
 */
export function drainUserMessages(sessionId: string): UserMessage[] {
  const managed = getManagedSession(sessionId);
  const drained = managed.userMessageQueue;
  managed.userMessageQueue = [];
  return drained;
}

export function getInterjectionNonce(sessionId: string): string {
  return getManagedSession(sessionId).interjectionNonce;
}

/**
 * Legacy export — preserved so existing route handlers that imported it keep
 * compiling while we migrate them. Prefer `enqueueUserMessage`.
 * @deprecated use enqueueUserMessage
 */
export function resolveUserResponse(sessionId: string, text: string): void {
  enqueueUserMessage(sessionId, text);
}

export async function closeSession(sessionId: string): Promise<void> {
  const session = sessions.get(sessionId);
  if (!session) return;
  if (session.pendingUserResponse !== null) {
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
    logger.error({ sessionId, err }, 'Failed to stop browser');
  }
  logger.info({ sessionId }, 'Closed session');
}

export async function closeAllSessions(): Promise<void> {
  for (const id of sessions.keys()) {
    await closeSession(id);
  }
}

export function sessionCount(): number {
  return sessions.size;
}
