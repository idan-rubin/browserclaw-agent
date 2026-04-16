// Agent loop
export {
  runAgentLoop,
  buildInterjectionBlock,
  assertNavigateUrlAllowed,
  assertExtractExpressionAllowed,
  shouldCheckTermination,
} from './agent-loop.js';
export type { PageHolder, UserChatHooks, TerminationJudgment, AgentLoopOptions } from './agent-loop.js';

// Session management
export {
  emitSSE,
  addSSEClient,
  startCleanupLoop,
  stopCleanupLoop,
  createSession,
  getSession,
  getSessionResult,
  waitForUserResponse,
  enqueueUserMessage,
  drainUserMessages,
  getInterjectionNonce,
  closeSession,
  closeAllSessions,
  sessionCount,
} from './session-manager.js';

// LLM utilities
export {
  runWithLlmConfig,
  llm,
  llmJson,
  llmVision,
  sanitizeErrorText,
  getAvailableProviders,
  getActiveProvider,
  getModel,
  getLLMCallCount,
  resetLLMCallCount,
  getTokenUsage,
  BYOK_PROVIDERS,
} from './llm.js';
export type { TokenUsage, ProviderConfig, LLMRequest } from './llm.js';

// Skills
export { pressAndHold, detectAntiBot, enrichSnapshot, getPageText } from './skills/press-and-hold.js';
export { clickCloudflareCheckbox } from './skills/cloudflare-checkbox.js';
export { detectPopup, dismissPopup } from './skills/dismiss-popup.js';
export { detectLoop } from './skills/loop-detection.js';
export { detectPageState, shouldBlockDone } from './skills/page-state.js';
export { diagnoseStuckAgent, formatRecovery } from './skills/recovery.js';
export { TabManager } from './skills/tab-manager.js';
export { getCdpBaseUrl, activateCdpTarget } from './skills/cdp-utils.js';

// Lesson store
export {
  initLessonStore,
  hashTaskCategory,
  getLesson,
  saveLesson,
  extractDomainLessons,
  formatLessonForPrompt,
} from './lesson-store.js';

// Skill store
export { initSkillStore, extractDomain, getSkillForDomain, getSkillsForDomains, saveSkill } from './skill-store.js';

// Skill generation
export { generateSkill, generateSkillTags, mergeSkills } from './skill-generator.js';

// Trajectory store
export { initTrajectoryStore, saveTrajectory, loadTrajectory, TRAJECTORY_STATUS } from './trajectory-store.js';
export type { TrajectoryRecord, TrajectoryStatus } from './trajectory-store.js';

// Utilities
export { webSearch } from './web-search.js';
export { judgeRun } from './judge.js';
export { moderatePrompt } from './content-policy.js';
export { parseJsonResponse } from './parse-json-response.js';
export { logger } from './logger.js';

// Config — timing constants and env helpers
export {
  requireEnv,
  requireEnvInt,
  getMinioConfig,
  validateConfig,
  WAIT_AFTER_TYPE_MS,
  WAIT_AFTER_CLICK_MS,
  WAIT_AFTER_OTHER_MS,
  WAIT_ACTION_MS,
  SCROLL_PIXELS,
  USER_RESPONSE_TIMEOUT_MS,
  MAX_STEPS,
  LLM_MAX_TOKENS,
  USER_INTERJECTION_ENABLED,
  MAX_INTERJECTIONS_PER_RUN,
  INTERJECTION_MIN_INTERVAL_MS,
  INTERJECTION_MAX_CHARS,
  INTERJECTION_INJECTION_MAX_CHARS,
} from './config.js';
export type { MinioConfig } from './config.js';

// Types
export type {
  Session,
  SessionStatus,
  UserMessage,
  LlmProvider,
  LlmConfig,
  CreateSessionRequest,
  AgentActionType,
  AgentAction,
  AgentStep,
  AgentProgress,
  AgentLoopResult,
  SkillOutput,
  SkillStep,
  SkillMetadata,
  CatalogSkill,
  DomainSkillEntry,
  DomainLesson,
  TaskLesson,
} from './types.js';
export { HttpError, LlmParseError } from './types.js';
