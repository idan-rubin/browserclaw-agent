export interface Session {
  id: string;
  prompt: string;
  created_at: string;
  last_activity_at: string;
  status: SessionStatus;
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
}

export interface SkillOutput {
  title: string;
  description: string;
  steps: SkillStep[];
  tips: string[];
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
  /** First 200 chars of the raw LLM response for diagnostics */
  readonly responseSnippet: string;

  constructor(message: string, rawResponse: string) {
    super(message);
    this.name = 'LlmParseError';
    this.responseSnippet = rawResponse.slice(0, 200);
  }
}
