import { describe, it, expect, vi } from 'vitest';
import { createServer, type Server } from 'node:net';

vi.mock('../config.js', () => ({
  requireEnvInt: vi.fn(() => 100),
  USER_RESPONSE_TIMEOUT_MS: 1000,
  USER_INTERJECTION_ENABLED: false,
  MAX_INTERJECTIONS_PER_RUN: 0,
  INTERJECTION_MIN_INTERVAL_MS: 0,
  getMinioConfig: vi.fn(() => ({ endpoint: '', bucket: '', accessKey: '', secretKey: '' })),
}));
vi.mock('../logger.js', () => ({ logger: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), fatal: vi.fn() } }));
vi.mock('../llm.js', () => ({
  getLLMCallCount: vi.fn(() => 0),
  resetLLMCallCount: vi.fn(),
  runWithLlmConfig: vi.fn(),
  llmJson: vi.fn(),
}));
vi.mock('../agent-loop.js', () => ({ runAgentLoop: vi.fn() }));
vi.mock('../skill-generator.js', () => ({
  generateSkill: vi.fn(),
  generateSkillTags: vi.fn(),
  mergeSkills: vi.fn(),
}));
vi.mock('../judge.js', () => ({ judgeRun: vi.fn() }));
vi.mock('../content-policy.js', () => ({ moderatePrompt: vi.fn() }));
vi.mock('../prompt-log.js', () => ({ logPrompt: vi.fn() }));
vi.mock('../skill-store.js', () => ({
  extractDomain: vi.fn(),
  getSkillForDomain: vi.fn(),
  getSkillsForDomains: vi.fn(),
  saveSkill: vi.fn(),
}));
vi.mock('../lesson-store.js', () => ({
  saveLesson: vi.fn(),
  extractDomainLessons: vi.fn(),
}));

const { nextAvailableCdpPort } = await import('../session-manager.js');

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

describe('nextAvailableCdpPort', () => {
  it('returns base port when free', async () => {
    const port = await nextAvailableCdpPort();
    expect(port).toBe(9222);
  });

  it('skips ports in the exclude set even when free', async () => {
    const port = await nextAvailableCdpPort(new Set([9222, 9223]));
    expect(port).toBe(9224);
  });

  it('skips occupied ports', async () => {
    const s = await occupyPort(9222);
    try {
      const port = await nextAvailableCdpPort();
      expect(port).toBe(9223);
    } finally {
      await closeServer(s);
    }
  });

  it('skips both occupied and excluded ports', async () => {
    const s = await occupyPort(9222);
    try {
      const port = await nextAvailableCdpPort(new Set([9223]));
      expect(port).toBe(9224);
    } finally {
      await closeServer(s);
    }
  });
});
