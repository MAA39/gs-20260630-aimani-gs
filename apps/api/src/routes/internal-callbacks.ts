import { Hono } from 'hono';
import {
  markRunGenerating,
  markRunRepairing,
  completeRunAtomic,
  failRun,
} from '@aimani-gs/db/ai-pipeline';
import { DbConflictError, InvalidTransitionError } from '@aimani-gs/db';
import { jsonBodyLimit, BODY_LIMITS } from '../middleware/body-limit.ts';

type Bindings = {
  DB: D1Database;
  INTERNAL_CALLBACK_KEY: string;
};

const ALLOWED_ERROR_CODES = new Set([
  'AI_CONFIGURATION_ERROR',
  'AI_PROVIDER_TIMEOUT',
  'AI_OUTPUT_INVALID',
  'AI_INPUT_INVALID',
  'AI_RUN_FAILED',
  'AI_DISPATCH_FAILED',
]);

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  AI_CONFIGURATION_ERROR: 'Agent configuration missing or invalid',
  AI_PROVIDER_TIMEOUT: 'AI provider did not respond within time limit',
  AI_OUTPUT_INVALID: 'AI output failed validation after repair attempt',
  AI_INPUT_INVALID: 'Dispatch payload missing required fields',
  AI_RUN_FAILED: 'AI workflow encountered an unexpected error',
  AI_DISPATCH_FAILED: 'Workflow dispatch failed',
};

const PROTOCOL_VERSION = '1';
const AI_MESSAGE_COUNT = 1;
const MIN_AI_MESSAGE_LENGTH = 1;
const MAX_AI_MESSAGE_LENGTH = 12_000;
const HEX_HASH_PATTERN = /^[0-9a-f]{64}$/u;

function verifyCallbackKey(requestKey: string | undefined, expectedKey: string): boolean {
  if (!expectedKey || !requestKey) return false;
  if (requestKey.length !== expectedKey.length) return false;
  let mismatch = 0;
  for (let i = 0; i < expectedKey.length; i++) {
    mismatch |= requestKey.charCodeAt(i) ^ expectedKey.charCodeAt(i);
  }
  return mismatch === 0;
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function isSafeNonNegativeInt(v: unknown): v is number {
  return typeof v === 'number' && Number.isSafeInteger(v) && v >= 0;
}

async function safeParseJson(c: { req: { json: () => Promise<unknown> } }): Promise<unknown> {
  try { return await c.req.json(); } catch { return null; }
}

/** SHA-256 hash of content, returned as 64-char lowercase hex */
async function computeHash(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const digest = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(digest))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function validateAiTurnBody(body: string): string | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(body);
  } catch {
    return 'invalid payload: AI message body must be JSON';
  }
  if (!isRecord(parsed)) return 'invalid payload: AI message body must be an object';
  if (typeof parsed.quote_span !== 'string' || !parsed.quote_span.trim()) {
    return 'invalid payload: quote_span required';
  }
  if (typeof parsed.response_text !== 'string' || !parsed.response_text.trim()) {
    return 'invalid payload: response_text required';
  }
  if (!Array.isArray(parsed.questions) || parsed.questions.length < 1) {
    return 'invalid payload: questions required';
  }
  for (const question of parsed.questions) {
    if (!isRecord(question) || typeof question.question !== 'string' || !question.question.trim()) {
      return 'invalid payload: question text required';
    }
    if (!Array.isArray(question.options) || question.options.length < 3 || question.options.length > 4) {
      return 'invalid payload: each question requires 3-4 options';
    }
    if (!question.options.every((option) => typeof option === 'string' && option.trim())) {
      return 'invalid payload: all options must be non-empty strings';
    }
  }
  return null;
}

export const internalCallbackRoutes = new Hono<{ Bindings: Bindings }>()
  .use('*', async (c, next) => {
    const key = c.req.header('X-Callback-Key');
    if (!verifyCallbackKey(key, c.env.INTERNAL_CALLBACK_KEY)) {
      return c.json({ error: 'unauthorized' }, 401);
    }
    return next();
  })

  .post('/:aiRunId/generating', jsonBodyLimit(BODY_LIMITS.internalSmall), async (c) => {
    const aiRunId = c.req.param('aiRunId');
    try {
      await markRunGenerating({
        db: c.env.DB as unknown as Parameters<typeof markRunGenerating>[0]['db'],
        aiRunId,
        eventId: crypto.randomUUID(),
        flueRunId: null,
      });
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof InvalidTransitionError) return c.json({ error: 'invalid_transition' }, 409);
      throw error;
    }
  })

  .post('/:aiRunId/repairing', jsonBodyLimit(BODY_LIMITS.internalSmall), async (c) => {
    const aiRunId = c.req.param('aiRunId');
    try {
      await markRunRepairing({
        db: c.env.DB as unknown as Parameters<typeof markRunRepairing>[0]['db'],
        aiRunId,
        eventId: crypto.randomUUID(),
      });
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof InvalidTransitionError) return c.json({ error: 'invalid_transition' }, 409);
      throw error;
    }
  })

  .post('/:aiRunId/complete', jsonBodyLimit(BODY_LIMITS.internalComplete), async (c) => {
    const aiRunId = c.req.param('aiRunId');
    const raw = await safeParseJson(c);

    if (!isRecord(raw)) return c.json({ error: 'invalid payload: expected JSON object' }, 400);
    if (raw.protocolVersion !== PROTOCOL_VERSION) {
      return c.json({ error: `invalid payload: protocolVersion "${PROTOCOL_VERSION}" required` }, 400);
    }
    if (raw.aiRunId !== aiRunId) return c.json({ error: 'invalid payload: aiRunId required and must match path' }, 400);
    if (typeof raw.resultHash !== 'string' || !HEX_HASH_PATTERN.test(raw.resultHash)) {
      return c.json({ error: 'invalid payload: resultHash must be 64-char hex string' }, 400);
    }

    if (!Array.isArray(raw.messages) || raw.messages.length !== AI_MESSAGE_COUNT) {
      return c.json({ error: 'invalid payload: exactly one AI message required' }, 400);
    }

    const firstMessage = raw.messages[0];
    if (!isRecord(firstMessage) || typeof firstMessage.body !== 'string') {
      return c.json({ error: 'invalid payload: message body string required' }, 400);
    }
    const body = firstMessage.body.trim();
    if (body.length < MIN_AI_MESSAGE_LENGTH || body.length > MAX_AI_MESSAGE_LENGTH) {
      return c.json({ error: `invalid payload: message body must be ${MIN_AI_MESSAGE_LENGTH}-${MAX_AI_MESSAGE_LENGTH} chars after trim` }, 400);
    }
    const validationError = validateAiTurnBody(body);
    if (validationError) return c.json({ error: validationError }, 400);

    const expectedHash = await computeHash(body);
    if (raw.resultHash !== expectedHash) {
      return c.json({ error: 'invalid payload: resultHash does not match message content' }, 400);
    }

    if (raw.usage !== undefined) {
      if (!isRecord(raw.usage)) return c.json({ error: 'invalid payload: usage must be an object' }, 400);
      for (const field of ['inputTokens', 'outputTokens', 'cacheReadTokens', 'cacheWriteTokens', 'estimatedCostMicros'] as const) {
        if (raw.usage[field] !== undefined && !isSafeNonNegativeInt(raw.usage[field])) {
          return c.json({ error: `invalid payload: usage.${field} must be a non-negative integer` }, 400);
        }
      }
    }

    const usage = isRecord(raw.usage) ? {
      inputTokens: isSafeNonNegativeInt(raw.usage.inputTokens) ? raw.usage.inputTokens : undefined,
      outputTokens: isSafeNonNegativeInt(raw.usage.outputTokens) ? raw.usage.outputTokens : undefined,
      cacheReadTokens: isSafeNonNegativeInt(raw.usage.cacheReadTokens) ? raw.usage.cacheReadTokens : undefined,
      cacheWriteTokens: isSafeNonNegativeInt(raw.usage.cacheWriteTokens) ? raw.usage.cacheWriteTokens : undefined,
      estimatedCostMicros: isSafeNonNegativeInt(raw.usage.estimatedCostMicros) ? raw.usage.estimatedCostMicros : undefined,
    } : undefined;

    try {
      const result = await completeRunAtomic({
        db: c.env.DB as unknown as Parameters<typeof completeRunAtomic>[0]['db'],
        aiRunId,
        resultHash: raw.resultHash as string,
        completedEventId: crypto.randomUUID(),
        replies: [{ messageId: crypto.randomUUID(), body }],
        usage,
      });
      return c.json({ ok: true, duplicate: result.duplicate, messageIds: result.messageIds });
    } catch (error) {
      if (error instanceof DbConflictError) return c.json({ error: 'conflict', message: error.message }, 409);
      if (error instanceof InvalidTransitionError) return c.json({ error: 'invalid_transition' }, 409);
      throw error;
    }
  })

  .post('/:aiRunId/fail', jsonBodyLimit(BODY_LIMITS.internalFail), async (c) => {
    const aiRunId = c.req.param('aiRunId');
    const raw = await safeParseJson(c);

    if (!isRecord(raw)) return c.json({ error: 'invalid payload: expected JSON object' }, 400);
    if (typeof raw.errorCode !== 'string' || !raw.errorCode) {
      return c.json({ error: 'invalid payload: errorCode string required' }, 400);
    }

    const errorCode = ALLOWED_ERROR_CODES.has(raw.errorCode) ? raw.errorCode : 'AI_RUN_FAILED';
    const errorMessage = SAFE_ERROR_MESSAGES[errorCode] || 'AI workflow encountered an unexpected error';

    try {
      await failRun({
        db: c.env.DB as unknown as Parameters<typeof failRun>[0]['db'],
        aiRunId,
        eventId: crypto.randomUUID(),
        errorCode,
        errorMessage,
      });
      return c.json({ ok: true });
    } catch (error) {
      if (error instanceof InvalidTransitionError) return c.json({ error: 'invalid_transition' }, 409);
      throw error;
    }
  });

/** Exported for tests to compute canonical hashes */
export { computeHash };
