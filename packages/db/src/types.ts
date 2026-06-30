// ── D1 database abstraction ─────────────────────────────
// unit test で FakeDb を差し込めるようにする軽量port。

import type { AuthorType, ConsultationVisibility } from '@aimani-gs/contracts';

export type D1ResultLike<T = unknown> = {
  results: T[];
};

export type D1BatchResultLike<T = unknown> = {
  results?: T[];
};

export interface D1PreparedStatementLike {
  bind(...values: unknown[]): this;
  first: {
    <T = unknown>(colName: string): Promise<T | null>;
    <T = unknown>(): Promise<T | null>;
  };
  all: <T = unknown>() => Promise<D1ResultLike<T>>;
  run: () => Promise<unknown>;
  raw: {
    <T = unknown>(options: { columnNames: true }): Promise<[string[], ...T[]]>;
    <T = unknown>(options?: { columnNames?: false }): Promise<T[]>;
  };
}

export type D1DatabaseClient<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  prepare: (query: string) => TStatement;
  batch: <T = unknown>(statements: TStatement[]) => Promise<D1BatchResultLike<T>[]>;
};

// ── AI run domain types ─────────────────────────────────

/** AI 生成フェーズ。initial = 相談作成時、deep_dive = 返信時 */
export type AiRunStage = 'initial' | 'deep_dive';

/** completing は導入しない。terminal 状態 = completed | failed */
export type AiRunStatus =
  | 'queued'
  | 'admitted'
  | 'generating'
  | 'repairing'
  | 'completed'
  | 'failed';

export type AiRunRow = {
  id: string;
  consultation_id: string;
  source_message_id: string;
  idempotency_key: string;
  stage: AiRunStage;
  status: AiRunStatus;
  model: string;
  prompt_version: string;
  flue_run_id: string | null;
  provider_request_id: string | null;
  attempt_count: number;
  input_tokens: number | null;
  output_tokens: number | null;
  cache_read_tokens: number | null;
  cache_write_tokens: number | null;
  estimated_cost_micros: number | null;
  result_hash: string | null;
  error_code: string | null;
  error_message: string | null;
  created_at: string;
  admitted_at: string | null;
  started_at: string | null;
  completed_at: string | null;
  updated_at: string;
};

export type AiRunEventRow = {
  id: string;
  ai_run_id: string;
  sequence: number;
  event_type: 'status' | 'completed' | 'failed';
  data_json: string;
  created_at: string;
};

// ── Error types ─────────────────────────────────────────

export class DbConflictError extends Error {
  readonly code = 'db_conflict';
  constructor(message: string) {
    super(message);
    this.name = 'DbConflictError';
  }
}

export class InvalidTransitionError extends Error {
  readonly code = 'invalid_transition';
  constructor(
    readonly aiRunId: string,
    readonly attemptedStatus: AiRunStatus,
  ) {
    super(`Invalid transition to '${attemptedStatus}' for ai_run '${aiRunId}'`);
    this.name = 'InvalidTransitionError';
  }
}

// ── Command input/result types ──────────────────────────

export type CreateQueuedRunInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  db: D1DatabaseClient<TStatement>;
  id: string;
  consultationId: string;
  sourceMessageId: string;
  idempotencyKey: string;
  stage: AiRunStage;
  model: string;
  promptVersion: string;
  queuedEventId: string;
};

export type TransitionRunInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  db: D1DatabaseClient<TStatement>;
  aiRunId: string;
  eventId: string;
};

export type MarkRunGeneratingInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = TransitionRunInput<TStatement> & {
  flueRunId: string | null;
};

/** caller 入力は messageId と body のみ。author_type='ai' は DB command 側で固定。 */
export type CompleteRunReplyInput = {
  messageId: string;
  body: string;
};

export type CompleteRunUsageInput = {
  inputTokens?: number | null;
  outputTokens?: number | null;
  cacheReadTokens?: number | null;
  cacheWriteTokens?: number | null;
  estimatedCostMicros?: number | null;
};

export type CompleteRunAtomicInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  db: D1DatabaseClient<TStatement>;
  aiRunId: string;
  resultHash: string;
  completedEventId: string;
  replies: readonly CompleteRunReplyInput[];
  usage?: CompleteRunUsageInput;
};

export type CompleteRunAtomicResult = {
  aiRunId: string;
  messageIds: string[];
  duplicate: boolean;
};

export type FailRunInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  db: D1DatabaseClient<TStatement>;
  aiRunId: string;
  eventId: string;
  errorCode: string;
  errorMessage: string;
};

export type AiGenerationContext = {
  aiRun: AiRunRow;
  consultation: {
    id: string;
    user_id: string;
    title: string;
    body: string;
    visibility: ConsultationVisibility;
  };
  sourceMessage: { id: string; message_number: number; author_type: AuthorType; body: string };
  recentMessages: Array<{
    id: string;
    message_number: number;
    author_type: AuthorType;
    body: string;
    parent_message_id: string | null;
  }>;
};

export type CreateConsultationWithQueuedRunInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  db: D1DatabaseClient<TStatement>;
  consultation: {
    id: string;
    userId: string;
    title: string;
    body: string;
    visibility: ConsultationVisibility;
  };
  message: { id: string; authorId: string };
  aiRun: {
    id: string;
    idempotencyKey: string;
    model: string;
    promptVersion: string;
  };
  queuedEventId: string;
};

export type CreateConsultationWithQueuedRunResult = {
  consultationId: string;
  firstMessageId: string;
  aiRunId: string;
};

export type InsertHumanMessageWithQueuedRunInput<
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
> = {
  db: D1DatabaseClient<TStatement>;
  message: {
    id: string;
    consultationId: string;
    authorId: string;
    body: string;
  };
  aiRun: {
    id: string;
    idempotencyKey: string;
    model: string;
    promptVersion: string;
  };
  queuedEventId: string;
};

export type InsertHumanMessageWithQueuedRunResult = {
  messageId: string;
  messageNumber: number;
  consultationTitle: string;
  aiRunId: string;
};
