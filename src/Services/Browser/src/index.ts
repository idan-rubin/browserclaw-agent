export {
  runAgentLoop,
  buildInterjectionBlock,
  assertNavigateUrlAllowed,
  assertExtractExpressionAllowed,
  shouldCheckTermination,
} from './agent-loop.js';
export type { AgentLoopOptions, PageHolder, UserChatHooks, TerminationJudgment } from './agent-loop.js';

export {
  createSession,
  getSession,
  getSessionResult,
  closeSession,
  closeAllSessions,
  sessionCount,
  addSSEClient,
  emitSSE,
  startCleanupLoop,
  stopCleanupLoop,
  waitForUserResponse,
  enqueueUserMessage,
  drainUserMessages,
} from './session-manager.js';

export { pressAndHold, detectAntiBot, enrichSnapshot, getPageText } from './skills/press-and-hold.js';
export { clickCloudflareCheckbox } from './skills/cloudflare-checkbox.js';
export { detectPopup, dismissPopup } from './skills/dismiss-popup.js';
export { detectLoop } from './skills/loop-detection.js';
export { detectPageState, shouldBlockDone } from './skills/page-state.js';
export { diagnoseStuckAgent, formatRecovery } from './skills/recovery.js';
export type { RecoveryStrategy } from './skills/recovery.js';
export { TabManager } from './skills/tab-manager.js';

export { initSkillStore, extractDomain, getSkillForDomain, getSkillsForDomains, saveSkill } from './skill-store.js';

export {
  initLessonStore,
  getLesson,
  saveLesson,
  extractDomainLessons,
  formatLessonForPrompt,
  hashTaskCategory,
} from './lesson-store.js';

export {
  llm,
  llmJson,
  llmVision,
  runWithLlmConfig,
  getAvailableProviders,
  getActiveProvider,
  getModel,
  sanitizeErrorText,
} from './llm.js';
export type { LLMRequest, TokenUsage, ProviderConfig } from './llm.js';

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
