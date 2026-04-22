export interface Session {
  id: string;
  prompt: string;
  created_at: string;
  last_activity_at: string;
  status: SessionStatus;
}

export interface UserMessage {
  text: string;
  receivedAt: Date;
}

export type SessionStatus = 'pending' | 'running' | 'waiting_for_user' | 'completed' | 'failed';

export type LlmProvider = 'anthropic' | 'openai' | 'openai-oauth' | 'gemini';

export interface LlmConfig {
  provider: LlmProvider;
  model: string;
  api_key: string;
}

export interface CreateSessionRequest {
  prompt: string;
  url?: string;
  headless?: boolean;
  skip_moderation?: boolean;
  /**
   * When true, skip post-run work that exists on this service but not on
   * bare OSS agents (skill generation, judge, domain-skill aggregation).
   * Used by apples-to-apples comparison runs so token totals reflect only
   * the agent loop itself.
   */
  skip_postprocessing?: boolean;
  llm_config?: LlmConfig;
}

export type AgentActionType =
  | 'click'
  | 'type'
  | 'navigate'
  | 'back'
  | 'select'
  | 'scroll'
  | 'keyboard'
  | 'wait'
  | 'press_and_hold'
  | 'click_cloudflare'
  | 'extract'
  | 'web_search'
  | 'switch_tab'
  | 'close_tab'
  | 'done'
  | 'fail'
  | 'ask_user';

export interface AgentAction {
  action: AgentActionType;
  reasoning: string;
  /** Accumulated facts, data, findings across steps — the agent's persistent scratchpad */
  memory?: string;
  /** What the agent plans to do next — maintains goal focus across long runs */
  next_goal?: string;
  /** Assessment of whether the previous action achieved its goal */
  evaluation_previous_goal?: string;
  answer?: string;
  ref?: string;
  text?: string;
  url?: string;
  key?: string;
  options?: string[];
  direction?: 'up' | 'down';
  /** JavaScript expression to evaluate in the page (for extract action) */
  expression?: string;
  /** Tab ID to switch to or close (for switch_tab / close_tab actions) */
  tab_id?: string;
  /** Hold duration in ms (for press_and_hold). Omit for the default 4–10s randomized hold. */
  hold_ms?: number;
  /** Search query (for web_search action) */
  query?: string;
  /** Batch of URLs to extract items from in parallel (for extract action) */
  urls?: string[];
  /** Result of extract action — set by the agent loop, shown in next step's history */
  extract_result?: string;
  /** Set by the agent loop when action execution fails — fed back to LLM in next step */
  error_feedback?: string;
}

export interface AgentStep {
  step: number;
  action: AgentAction;
  snapshot_text?: string;
  url?: string;
  page_title?: string;
  timestamp: string;
  user_response?: string;
  /** Natural language description of the action outcome — what changed on the page */
  outcome?: string;
}

export interface AgentProgress {
  completed: string[];
  current: string;
  blocked_by: string | null;
}

export interface SkillOutput {
  title: string;
  description: string;
  steps: SkillStep[];
  tips: string[];
  /** Patterns that worked well during execution */
  what_worked?: string[];
  /** Known failure modes from rejected runs */
  failure_notes?: string[];
  metadata: SkillMetadata;
  markdown: string;
}

export interface SkillStep {
  number: number;
  description: string;
  action: AgentActionType;
  details?: string;
}

export interface SkillMetadata {
  prompt: string;
  url: string;
  total_steps: number;
  duration_ms: number;
  generated_at: string;
}

export interface AgentLoopResult {
  success: boolean;
  steps: AgentStep[];
  answer?: string;
  error?: string;
  duration_ms: number;
  final_url?: string;
  validation_warnings?: string[];
}

export interface CatalogSkill {
  id: string;
  domain: string;
  skill: SkillOutput;
  tags: string[];
  created_at: string;
  run_count: number;
}

export interface DomainSkillEntry {
  domain: string;
  skill: SkillOutput;
  source: 'catalog' | 'generated';
  tags: string[];
  run_count: number;
}

export interface DomainLesson {
  domain: string;
  status: 'blocked' | 'worked';
  reason: string;
  last_seen: string;
}

export interface TaskLesson {
  task_hash: string;
  task_terms: string[];
  domains: DomainLesson[];
  updated_at: string;
}

export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'HttpError';
  }
}

export class LlmParseError extends Error {
  /** First 500 chars of the raw LLM response for diagnostics */
  readonly responseSnippet: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = 'LlmParseError';
    this.responseSnippet = rawResponse.slice(0, 500);
  }
}
