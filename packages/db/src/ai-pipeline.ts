import type {
  AiGenerationContext,
  AiRunEventRow,
  AiRunRow,
  AiRunStatus,
  CompleteRunAtomicInput,
  CompleteRunAtomicResult,
  CompleteRunUsageInput,
  CreateConsultationWithQueuedRunInput,
  CreateConsultationWithQueuedRunResult,
  CreateQueuedRunInput,
  D1BatchResultLike,
  D1DatabaseClient,
  D1PreparedStatementLike,
  FailRunInput,
  InsertHumanMessageWithQueuedRunInput,
  InsertHumanMessageWithQueuedRunResult,
  MarkRunGeneratingInput,
  TransitionRunInput,
} from './types.ts';
import { DbConflictError, InvalidTransitionError } from './types.ts';

// ── SQL fragments ───────────────────────────────────────

const AI_RUN_COLUMNS = [
  'id', 'consultation_id', 'source_message_id', 'idempotency_key',
  'stage', 'status', 'model', 'prompt_version',
  'flue_run_id', 'provider_request_id', 'attempt_count',
  'input_tokens', 'output_tokens', 'cache_read_tokens',
  'cache_write_tokens', 'estimated_cost_micros', 'result_hash',
  'error_code', 'error_message',
  'created_at', 'admitted_at', 'started_at', 'completed_at', 'updated_at',
].join(', ');

const selectAiRunByIdSql = `SELECT ${AI_RUN_COLUMNS} FROM ai_runs WHERE id = ?`;
const selectAiRunByIdempotencyKeySql = `SELECT ${AI_RUN_COLUMNS} FROM ai_runs WHERE idempotency_key = ?`;
const RECENT_MESSAGES_LIMIT = 8;

// ── Helpers ─────────────────────────────────────────────

const now = () => "strftime('%Y-%m-%dT%H:%M:%fZ', 'now')";

const jsonData = (value: unknown): string => {
  const encoded = JSON.stringify(value);
  if (encoded === undefined) throw new Error('Cannot encode event data as JSON');
  return encoded;
};

const firstBatchRow = <T>(
  result: D1BatchResultLike<unknown> | undefined,
  label: string,
): T => {
  const row = result?.results?.[0] as T | undefined;
  if (row === undefined) throw new Error(`D1 batch did not return created ${label}`);
  return row;
};

const isUniqueConstraintError = (error: unknown): boolean => {
  const message = error instanceof Error ? error.message : String(error);
  return message.includes('UNIQUE constraint failed');
};

const withConflictMapping = async <T>(
  action: () => Promise<T>,
  message: string,
): Promise<T> => {
  try {
    return await action();
  } catch (error) {
    if (isUniqueConstraintError(error)) throw new DbConflictError(message);
    throw error;
  }
};

const assertTransitioned = (
  runAfter: AiRunRow,
  expectedStatus: AiRunStatus,
  aiRunId: string,
): void => {
  if (runAfter.status !== expectedStatus) throw new InvalidTransitionError(aiRunId, expectedStatus);
};

// ── Queued run creation ─────────────────────────────────

export const createQueuedRun = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: CreateQueuedRunInput<TStatement>): Promise<AiRunRow> => {
  const results = await withConflictMapping(
    () => input.db.batch([
      input.db.prepare([
        'INSERT INTO ai_runs',
        '(id, consultation_id, source_message_id, idempotency_key,',
        'stage, status, model, prompt_version)',
        'SELECT ?, ?, ?, ?, ?, ?, ?, ?',
        'WHERE EXISTS (SELECT 1 FROM messages WHERE id = ? AND consultation_id = ?)',
      ].join(' ')).bind(
        input.id,
        input.consultationId,
        input.sourceMessageId,
        input.idempotencyKey,
        input.stage,
        'queued',
        input.model,
        input.promptVersion,
        input.sourceMessageId,
        input.consultationId,
      ),
      input.db.prepare([
        'INSERT INTO ai_run_events',
        '(id, ai_run_id, sequence, event_type, data_json)',
        'SELECT ?, ?, 1, ?, ?',
        'WHERE changes() > 0',
      ].join(' ')).bind(input.queuedEventId, input.id, 'status', jsonData({ status: 'queued' })),
      input.db.prepare(selectAiRunByIdSql).bind(input.id),
    ]),
    'ai_run idempotency key conflicts with an existing run',
  );

  const run = results[2]?.results?.[0] as AiRunRow | undefined;
  if (run === undefined) {
    throw new Error(`source message '${input.sourceMessageId}' does not belong to consultation '${input.consultationId}'`);
  }
  return run;
};

// ── Read operations ─────────────────────────────────────

export const getAiRunById = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(
  db: D1DatabaseClient<TStatement>,
  aiRunId: string,
): Promise<AiRunRow | null> =>
  db.prepare(selectAiRunByIdSql).bind(aiRunId).first<AiRunRow>();

export const getAiRunByIdempotencyKey = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(
  db: D1DatabaseClient<TStatement>,
  idempotencyKey: string,
): Promise<AiRunRow | null> =>
  db.prepare(selectAiRunByIdempotencyKeySql).bind(idempotencyKey).first<AiRunRow>();

// ── Compare-and-set state transitions ───────────────────

/** queued → admitted */
export const markRunAdmitted = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: TransitionRunInput<TStatement>): Promise<AiRunRow> => {
  const results = await input.db.batch([
    input.db.prepare([
      'UPDATE ai_runs',
      `SET status = 'admitted',`,
      `admitted_at = COALESCE(admitted_at, ${now()}),`,
      `updated_at = ${now()}`,
      `WHERE id = ? AND status = 'queued'`,
    ].join(' ')).bind(input.aiRunId),
    input.db.prepare([
      'INSERT INTO ai_run_events',
      '(id, ai_run_id, sequence, event_type, data_json)',
      'SELECT ?, ?,',
      '(SELECT COALESCE(MAX(sequence), 0) + 1 FROM ai_run_events WHERE ai_run_id = ?),',
      '?, ?',
      'WHERE changes() > 0',
    ].join(' ')).bind(input.eventId, input.aiRunId, input.aiRunId, 'status', jsonData({ status: 'admitted' })),
    input.db.prepare(selectAiRunByIdSql).bind(input.aiRunId),
  ]);

  const run = firstBatchRow<AiRunRow>(results[2], 'ai run');
  assertTransitioned(run, 'admitted', input.aiRunId);
  return run;
};

/** admitted → generating */
export const markRunGenerating = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: MarkRunGeneratingInput<TStatement>): Promise<AiRunRow> => {
  const results = await input.db.batch([
    input.db.prepare([
      'UPDATE ai_runs',
      `SET status = 'generating',`,
      'flue_run_id = COALESCE(?, flue_run_id),',
      `started_at = COALESCE(started_at, ${now()}),`,
      'attempt_count = CASE WHEN attempt_count = 0 THEN 1 ELSE attempt_count END,',
      `updated_at = ${now()}`,
      `WHERE id = ? AND status = 'admitted'`,
    ].join(' ')).bind(input.flueRunId, input.aiRunId),
    input.db.prepare([
      'INSERT INTO ai_run_events',
      '(id, ai_run_id, sequence, event_type, data_json)',
      'SELECT ?, ?,',
      '(SELECT COALESCE(MAX(sequence), 0) + 1 FROM ai_run_events WHERE ai_run_id = ?),',
      '?, ?',
      'WHERE changes() > 0',
    ].join(' ')).bind(input.eventId, input.aiRunId, input.aiRunId, 'status', jsonData({ status: 'generating' })),
    input.db.prepare(selectAiRunByIdSql).bind(input.aiRunId),
  ]);

  const run = firstBatchRow<AiRunRow>(results[2], 'ai run');
  assertTransitioned(run, 'generating', input.aiRunId);
  return run;
};

/** generating → repairing */
export const markRunRepairing = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: TransitionRunInput<TStatement>): Promise<AiRunRow> => {
  const results = await input.db.batch([
    input.db.prepare([
      'UPDATE ai_runs',
      `SET status = 'repairing',`,
      'attempt_count = attempt_count + 1,',
      `updated_at = ${now()}`,
      `WHERE id = ? AND status = 'generating'`,
    ].join(' ')).bind(input.aiRunId),
    input.db.prepare([
      'INSERT INTO ai_run_events',
      '(id, ai_run_id, sequence, event_type, data_json)',
      'SELECT ?, ?,',
      '(SELECT COALESCE(MAX(sequence), 0) + 1 FROM ai_run_events WHERE ai_run_id = ?),',
      '?, ?',
      'WHERE changes() > 0',
    ].join(' ')).bind(input.eventId, input.aiRunId, input.aiRunId, 'status', jsonData({ status: 'repairing' })),
    input.db.prepare(selectAiRunByIdSql).bind(input.aiRunId),
  ]);

  const run = firstBatchRow<AiRunRow>(results[2], 'ai run');
  assertTransitioned(run, 'repairing', input.aiRunId);
  return run;
};

// ── Terminal transitions ────────────────────────────────

/** queued | admitted | generating | repairing → failed */
export const failRun = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: FailRunInput<TStatement>): Promise<AiRunRow> => {
  const truncatedMessage = input.errorMessage.slice(0, 500);
  const results = await input.db.batch([
    input.db.prepare([
      'UPDATE ai_runs',
      `SET status = 'failed',`,
      'error_code = ?,',
      'error_message = ?,',
      `updated_at = ${now()}`,
      `WHERE id = ? AND status IN ('queued', 'admitted', 'generating', 'repairing')`,
    ].join(' ')).bind(input.errorCode, truncatedMessage, input.aiRunId),
    input.db.prepare([
      'INSERT INTO ai_run_events',
      '(id, ai_run_id, sequence, event_type, data_json)',
      'SELECT ?, ?,',
      '(SELECT COALESCE(MAX(sequence), 0) + 1 FROM ai_run_events WHERE ai_run_id = ?),',
      '?, ?',
      'WHERE changes() > 0',
    ].join(' ')).bind(input.eventId, input.aiRunId, input.aiRunId, 'failed', jsonData({ status: 'failed', error_code: input.errorCode })),
    input.db.prepare(selectAiRunByIdSql).bind(input.aiRunId),
  ]);

  const run = firstBatchRow<AiRunRow>(results[2], 'ai run');
  assertTransitioned(run, 'failed', input.aiRunId);
  return run;
};

/** generating | repairing → completed */
export const completeRunAtomic = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: CompleteRunAtomicInput<TStatement>): Promise<CompleteRunAtomicResult> => {
  const run = await input.db.prepare(selectAiRunByIdSql).bind(input.aiRunId).first<AiRunRow>();
  if (run === null) throw new Error('AI run not found');

  if (run.status === 'completed') {
    if (run.result_hash !== input.resultHash) throw new DbConflictError('completed ai_run result hash conflict');
    const existingMessageIds = await selectMessageIdsForRun(input.db, input.aiRunId);
    return { aiRunId: input.aiRunId, messageIds: existingMessageIds, duplicate: true };
  }

  if (run.status !== 'generating' && run.status !== 'repairing') {
    throw new InvalidTransitionError(input.aiRunId, 'completed');
  }

  const messageIds = input.replies.map((reply) => reply.messageId);
  const insertMessageStatements = input.replies.map((reply) =>
    input.db.prepare([
      'INSERT INTO messages',
      '(id, consultation_id, message_number, author_type, author_id, body, parent_message_id)',
      'SELECT ?, ?,',
      '(SELECT COALESCE(MAX(message_number), 0) + 1 FROM messages WHERE consultation_id = ?),',
      "'ai', NULL, ?, ?",
      'WHERE EXISTS (',
      '  SELECT 1 FROM ai_runs a',
      '  JOIN messages m ON a.source_message_id = m.id AND m.consultation_id = a.consultation_id',
      "  WHERE a.id = ? AND a.status IN ('generating', 'repairing')",
      ')',
    ].join(' ')).bind(
      reply.messageId,
      run.consultation_id,
      run.consultation_id,
      reply.body,
      run.source_message_id,
      input.aiRunId,
    ),
  );

  const usage: CompleteRunUsageInput = input.usage ?? {};
  const batchResults = await withConflictMapping(
    () => input.db.batch([
      ...insertMessageStatements,
      input.db.prepare([
        'UPDATE ai_runs',
        `SET status = 'completed',`,
        'result_hash = ?,',
        'input_tokens = ?,',
        'output_tokens = ?,',
        'cache_read_tokens = ?,',
        'cache_write_tokens = ?,',
        'estimated_cost_micros = ?,',
        `completed_at = COALESCE(completed_at, ${now()}),`,
        `updated_at = ${now()}`,
        `WHERE id = ? AND status IN ('generating', 'repairing')`,
        'AND consultation_id = (SELECT consultation_id FROM messages WHERE id = source_message_id)',
      ].join(' ')).bind(
        input.resultHash,
        usage.inputTokens ?? null,
        usage.outputTokens ?? null,
        usage.cacheReadTokens ?? null,
        usage.cacheWriteTokens ?? null,
        usage.estimatedCostMicros ?? null,
        input.aiRunId,
      ),
      input.db.prepare([
        'INSERT INTO ai_run_events',
        '(id, ai_run_id, sequence, event_type, data_json)',
        'SELECT ?, ?,',
        '(SELECT COALESCE(MAX(sequence), 0) + 1 FROM ai_run_events WHERE ai_run_id = ?),',
        '?, ?',
        'WHERE changes() > 0',
      ].join(' ')).bind(input.completedEventId, input.aiRunId, input.aiRunId, 'completed', jsonData({ status: 'completed', message_ids: messageIds })),
      input.db.prepare(selectAiRunByIdSql).bind(input.aiRunId),
    ]),
    'ai_run completion conflicts with existing data',
  );

  const finalIdx = insertMessageStatements.length + 2;
  const finalRun = batchResults[finalIdx]?.results?.[0] as AiRunRow | undefined;
  if (finalRun === undefined || finalRun.status !== 'completed') {
    throw new InvalidTransitionError(input.aiRunId, 'completed');
  }
  if (finalRun.result_hash !== input.resultHash) {
    throw new DbConflictError('completed ai_run result hash conflict');
  }

  const savedMessageIds = await selectMessageIdsForRun(input.db, input.aiRunId);
  const insertedByThisCall =
    savedMessageIds.length === messageIds.length &&
    savedMessageIds.every((id, i) => id === messageIds[i]);

  return {
    aiRunId: input.aiRunId,
    messageIds: savedMessageIds,
    duplicate: !insertedByThisCall,
  };
};

// ── Event query ─────────────────────────────────────────

export const listAiRunEventsAfter = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(
  db: D1DatabaseClient<TStatement>,
  aiRunId: string,
  afterSequence: number,
): Promise<AiRunEventRow[]> => {
  const result = await db.prepare([
    'SELECT id, ai_run_id, sequence, event_type, data_json, created_at',
    'FROM ai_run_events',
    'WHERE ai_run_id = ? AND sequence > ?',
    'ORDER BY sequence ASC',
  ].join(' ')).bind(aiRunId, afterSequence).all<AiRunEventRow>();
  return result.results;
};

// ── Generation context ──────────────────────────────────

export const getAiGenerationContext = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(
  db: D1DatabaseClient<TStatement>,
  aiRunId: string,
): Promise<AiGenerationContext | null> => {
  const aiRun = await getAiRunById(db, aiRunId);
  if (aiRun === null) return null;

  const [consultation, sourceMessage] = await Promise.all([
    db.prepare('SELECT id, user_id, title, body, visibility FROM consultations WHERE id = ?')
      .bind(aiRun.consultation_id)
      .first<AiGenerationContext['consultation']>(),
    db.prepare('SELECT id, message_number, author_type, body FROM messages WHERE id = ?')
      .bind(aiRun.source_message_id)
      .first<AiGenerationContext['sourceMessage']>(),
  ]);

  if (consultation === null || sourceMessage === null) return null;

  const recentMessagesResult = await db.prepare([
    'SELECT id, message_number, author_type, body, parent_message_id',
    'FROM messages',
    'WHERE consultation_id = ? AND message_number < ?',
    'ORDER BY message_number DESC',
    'LIMIT ?',
  ].join(' '))
    .bind(aiRun.consultation_id, sourceMessage.message_number, RECENT_MESSAGES_LIMIT)
    .all<AiGenerationContext['recentMessages'][number]>();

  return { aiRun, consultation, sourceMessage, recentMessages: recentMessagesResult.results.reverse() };
};

// ── Atomic consultation/message + queued run ────────────

export const createConsultationWithInitialMessageAndQueuedRun = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: CreateConsultationWithQueuedRunInput<TStatement>): Promise<CreateConsultationWithQueuedRunResult> => {
  const { db, consultation, message, aiRun } = input;

  await withConflictMapping(
    () => db.batch([
      db.prepare([
        'INSERT INTO consultations (id, user_id, title, body, visibility)',
        'VALUES (?, ?, ?, ?, ?)',
      ].join(' ')).bind(
        consultation.id,
        consultation.userId,
        consultation.title,
        consultation.body,
        consultation.visibility,
      ),
      db.prepare([
        'INSERT INTO messages',
        '(id, consultation_id, message_number, author_type, author_id, body, parent_message_id)',
        'VALUES (?, ?, 1, COALESCE((SELECT role FROM user_roles WHERE user_id = ?), \'student\'), ?, ?, NULL)',
      ].join(' ')).bind(
        message.id,
        consultation.id,
        message.authorId,
        message.authorId,
        consultation.body,
      ),
      db.prepare([
        'INSERT INTO ai_runs',
        '(id, consultation_id, source_message_id, idempotency_key, stage, status, model, prompt_version)',
        "VALUES (?, ?, ?, ?, 'initial', 'queued', ?, ?)",
      ].join(' ')).bind(
        aiRun.id,
        consultation.id,
        message.id,
        aiRun.idempotencyKey,
        aiRun.model,
        aiRun.promptVersion,
      ),
      db.prepare([
        'INSERT INTO ai_run_events',
        '(id, ai_run_id, sequence, event_type, data_json)',
        'SELECT ?, ?, 1, ?, ?',
        'WHERE changes() > 0',
      ].join(' ')).bind(input.queuedEventId, aiRun.id, 'status', jsonData({ status: 'queued' })),
    ]),
    'ai_run idempotency key conflicts with an existing run',
  );

  return { consultationId: consultation.id, firstMessageId: message.id, aiRunId: aiRun.id };
};

export const insertHumanMessageWithQueuedRun = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(input: InsertHumanMessageWithQueuedRunInput<TStatement>): Promise<InsertHumanMessageWithQueuedRunResult> => {
  const { db, message, aiRun } = input;

  const results = await withConflictMapping(
    () => db.batch([
      db.prepare([
        'INSERT INTO messages',
        '(id, consultation_id, message_number, author_type, author_id, body, parent_message_id)',
        'SELECT ?, ?,',
        '(SELECT COALESCE(MAX(message_number), 0) + 1 FROM messages WHERE consultation_id = ?),',
        "COALESCE((SELECT role FROM user_roles WHERE user_id = ?), 'student'), ?, ?, NULL",
        'WHERE EXISTS (SELECT 1 FROM consultations WHERE id = ?)',
      ].join(' ')).bind(
        message.id,
        message.consultationId,
        message.consultationId,
        message.authorId,
        message.authorId,
        message.body,
        message.consultationId,
      ),
      db.prepare([
        'INSERT INTO ai_runs',
        '(id, consultation_id, source_message_id, idempotency_key, stage, status, model, prompt_version)',
        'SELECT ?, ?, ?, ?,',
        "'deep_dive', 'queued', ?, ?",
        'WHERE changes() > 0',
      ].join(' ')).bind(
        aiRun.id,
        message.consultationId,
        message.id,
        aiRun.idempotencyKey,
        aiRun.model,
        aiRun.promptVersion,
      ),
      db.prepare([
        'INSERT INTO ai_run_events',
        '(id, ai_run_id, sequence, event_type, data_json)',
        'SELECT ?, ?, 1, ?, ?',
        'WHERE changes() > 0',
      ].join(' ')).bind(input.queuedEventId, aiRun.id, 'status', jsonData({ status: 'queued' })),
      db.prepare([
        'SELECT m.message_number, c.title',
        'FROM messages m JOIN consultations c ON m.consultation_id = c.id',
        'WHERE m.id = ?',
      ].join(' ')).bind(message.id),
    ]),
    'ai_run idempotency key conflicts with an existing run',
  );

  const row = results[3]?.results?.[0] as { message_number: number; title: string } | undefined;
  if (row === undefined) throw new Error(`consultation '${message.consultationId}' not found or message insertion failed`);

  return {
    messageId: message.id,
    messageNumber: row.message_number,
    consultationTitle: row.title,
    aiRunId: aiRun.id,
  };
};

// ── Internal helpers ────────────────────────────────────

const selectMessageIdsForRun = async <
  TStatement extends D1PreparedStatementLike = D1PreparedStatementLike,
>(
  db: D1DatabaseClient<TStatement>,
  aiRunId: string,
): Promise<string[]> => {
  const result = await db.prepare([
    'SELECT m.id',
    'FROM messages m JOIN ai_runs a ON m.consultation_id = a.consultation_id',
    'WHERE a.id = ? AND m.parent_message_id = a.source_message_id AND m.author_type = \'ai\'',
    'ORDER BY m.message_number ASC',
  ].join(' ')).bind(aiRunId).all<{ id: string }>();
  return result.results.map((row) => row.id);
};
