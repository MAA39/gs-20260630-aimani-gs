import { Hono } from 'hono';
import {
  getConsultationDetail,
  getUserRole,
  listVisibleConsultations,
  normalizeVisibility,
  updateConsultationStatus,
} from '@aimani-gs/db';
import {
  createConsultationWithInitialMessageAndQueuedRun,
  insertHumanMessageWithQueuedRun,
  markRunAdmitted,
  failRun,
  getAiRunById,
  getAiGenerationContext,
} from '@aimani-gs/db/ai-pipeline';
import { getSessionResult, resolveAuthBaseURL } from '../auth.ts';
import { jsonBodyLimit, BODY_LIMITS } from '../middleware/body-limit.ts';

const AI_MODEL = '@cf/openai/gpt-oss-120b';
const PROMPT_VERSION = 'initial-v1';

type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  INTERNAL_CALLBACK_KEY: string;
  AGENT: { fetch: typeof fetch };
};

type WaitUntilCapable = { waitUntil: (promise: Promise<unknown>) => void };

async function computeIdempotencyKey(
  sourceMessageId: string,
  stage: string,
  promptVersion: string,
): Promise<string> {
  const input = `ai-run:v1:${sourceMessageId}:${stage}:${promptVersion}`;
  const encoded = new TextEncoder().encode(input);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function buildAuthConfig(env: Bindings) {
  return {
    secret: env.BETTER_AUTH_SECRET,
    githubClientId: env.GITHUB_CLIENT_ID,
    githubClientSecret: env.GITHUB_CLIENT_SECRET,
  };
}

async function getSessionForRequest(c: { env: Bindings; req: { raw: Request; url: string } }) {
  const baseURL = resolveAuthBaseURL(c.req.raw, new URL(c.req.url).origin, c.env.BETTER_AUTH_URL);
  return getSessionResult(c.env.DB, buildAuthConfig(c.env), baseURL, c.req.raw);
}

async function getViewer(c: { env: Bindings; req: { raw: Request; url: string } }) {
  const session = await getSessionForRequest(c);
  if (!session.ok) return { session, viewer: null };
  const role = await getUserRole(c.env.DB, session.user.id);
  return { session, viewer: { userId: session.user.id, role } };
}

async function dispatchWithRunLifecycle(
  agent: { fetch: typeof fetch },
  db: D1Database,
  callbackKey: string,
  aiRunId: string,
): Promise<void> {
  if (!callbackKey?.trim()) {
    try {
      await failRun({
        db: db as unknown as Parameters<typeof failRun>[0]['db'],
        aiRunId,
        eventId: crypto.randomUUID(),
        errorCode: 'AI_CONFIGURATION_ERROR',
        errorMessage: 'Internal callback key not configured',
      });
    } catch (failError) {
      console.error('failRun failed after missing callback key', {
        aiRunId,
        name: failError instanceof Error ? failError.name : 'UnknownError',
      });
      throw failError;
    }
    return;
  }

  await markRunAdmitted({
    db: db as unknown as Parameters<typeof markRunAdmitted>[0]['db'],
    aiRunId,
    eventId: crypto.randomUUID(),
  });

  let ctx: Awaited<ReturnType<typeof getAiGenerationContext>>;
  try {
    ctx = await getAiGenerationContext(
      db as unknown as Parameters<typeof getAiGenerationContext>[0],
      aiRunId,
    );
  } catch (contextError) {
    await failRun({
      db: db as unknown as Parameters<typeof failRun>[0]['db'],
      aiRunId,
      eventId: crypto.randomUUID(),
      errorCode: 'AI_DISPATCH_FAILED',
      errorMessage: 'Failed to build generation context',
    }).catch(() => undefined);
    throw contextError;
  }

  if (!ctx) {
    await failRun({
      db: db as unknown as Parameters<typeof failRun>[0]['db'],
      aiRunId,
      eventId: crypto.randomUUID(),
      errorCode: 'AI_DISPATCH_FAILED',
      errorMessage: 'generation context not found',
    });
    return;
  }

  try {
    const response = await agent.fetch(
      new Request('http://agent/workflows/generate-replies', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          aiRunId,
          context: {
            consultation: ctx.consultation,
            sourceMessage: {
              id: ctx.sourceMessage.id,
              messageNumber: ctx.sourceMessage.message_number,
              authorType: ctx.sourceMessage.author_type,
              body: ctx.sourceMessage.body,
            },
            recentMessages: ctx.recentMessages.map((m) => ({
              messageNumber: m.message_number,
              authorType: m.author_type,
              body: m.body,
            })),
            replyCount: 3,
            promptVersion: PROMPT_VERSION,
            stage: ctx.aiRun.stage,
          },
        }),
      }),
    );

    try {
      if (!response.ok) throw new Error(`Workflow dispatch failed with ${response.status}`);
    } finally {
      await response.body?.cancel().catch(() => undefined);
    }
  } catch (error) {
    const run = await getAiRunById(
      db as unknown as Parameters<typeof getAiRunById>[0],
      aiRunId,
    ).catch(() => null);
    if (run && run.status !== 'completed' && run.status !== 'failed') {
      await failRun({
        db: db as unknown as Parameters<typeof failRun>[0]['db'],
        aiRunId,
        eventId: crypto.randomUUID(),
        errorCode: 'AI_DISPATCH_FAILED',
        errorMessage: 'Workflow dispatch failed',
      }).catch((failError) => {
        console.error('failRun failed after dispatch error', {
          aiRunId,
          name: failError instanceof Error ? failError.name : 'UnknownError',
        });
      });
    }
    throw error;
  }
}

function logDispatchFailure(error: unknown): void {
  if (error instanceof Error) {
    console.error('AI workflow dispatch failed', { name: error.name, message: error.message });
    return;
  }
  console.error('AI workflow dispatch failed', { name: 'UnknownError' });
}

function authErrorResponse(session: Awaited<ReturnType<typeof getSessionForRequest>>) {
  if (session.ok) return null;
  if (session.reason === 'auth_misconfigured') return { body: { error: 'service not configured' }, status: 503 } as const;
  if (session.reason === 'auth_failure') return { body: { error: 'authentication service error' }, status: 500 } as const;
  return { body: { error: 'authentication required' }, status: 401 } as const;
}

export const consultationRoutes = new Hono<{ Bindings: Bindings }>()
  .get('/', async (context) => {
    const { viewer } = await getViewer(context);
    return context.json(await listVisibleConsultations(context.env.DB, viewer));
  })
  .get('/:id', async (context) => {
    const { viewer } = await getViewer(context);
    const detail = await getConsultationDetail(context.env.DB, context.req.param('id'), viewer);
    if (!detail) return context.json({ error: 'not found' }, 404);
    return context.json(detail);
  })
  .post('/', jsonBodyLimit(BODY_LIMITS.publicLarge), async (context) => {
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const input = await context.req.json<Record<string, unknown>>().catch(() => null);
    if (!input || typeof input !== 'object') return context.json({ error: 'invalid JSON body' }, 400);

    const ALLOWED_FIELDS = new Set(['title', 'body', 'visibility']);
    const unexpected = Object.keys(input).filter((k) => !ALLOWED_FIELDS.has(k));
    if (unexpected.length > 0) return context.json({ error: `unexpected fields: ${unexpected.join(', ')}` }, 400);

    const { title, body } = input;
    const visibility = normalizeVisibility(input.visibility ?? 'private');
    if (typeof title !== 'string' || typeof body !== 'string') {
      return context.json({ error: 'title and body must be strings' }, 400);
    }
    if (!visibility) return context.json({ error: 'visibility is invalid' }, 400);

    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody) return context.json({ error: 'title and body must not be empty' }, 400);

    const consultationId = crypto.randomUUID();
    const messageId = crypto.randomUUID();
    const aiRunId = crypto.randomUUID();
    const idempotencyKey = await computeIdempotencyKey(messageId, 'initial', PROMPT_VERSION);

    await createConsultationWithInitialMessageAndQueuedRun({
      db: context.env.DB as unknown as Parameters<typeof createConsultationWithInitialMessageAndQueuedRun>[0]['db'],
      consultation: {
        id: consultationId,
        userId: session.user.id,
        title: trimmedTitle,
        body: trimmedBody,
        visibility,
      },
      message: { id: messageId, authorId: session.user.id },
      aiRun: {
        id: aiRunId,
        idempotencyKey,
        model: AI_MODEL,
        promptVersion: PROMPT_VERSION,
      },
      queuedEventId: crypto.randomUUID(),
    });

    (context.executionCtx as WaitUntilCapable).waitUntil(
      dispatchWithRunLifecycle(
        context.env.AGENT,
        context.env.DB,
        context.env.INTERNAL_CALLBACK_KEY,
        aiRunId,
      ).catch(logDispatchFailure),
    );

    return context.json({ id: consultationId, title: trimmedTitle, ai_run: { id: aiRunId } }, 201);
  })
  .post('/:id/messages', jsonBodyLimit(BODY_LIMITS.publicLarge), async (context) => {
    const consultationId = context.req.param('id');
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const role = await getUserRole(context.env.DB, session.user.id);
    const readable = await getConsultationDetail(context.env.DB, consultationId, {
      userId: session.user.id,
      role,
    });
    if (!readable) return context.json({ error: 'not found' }, 404);

    const raw = await context.req.json<unknown>().catch(() => null);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return context.json({ error: 'invalid payload' }, 400);
    const record = raw as Record<string, unknown>;
    const extraKeys = Object.keys(record).filter((k) => k !== 'body');
    if (extraKeys.length > 0) return context.json({ error: 'server-owned fields are not allowed' }, 400);
    if (typeof record.body !== 'string' || !record.body.trim()) {
      return context.json({ error: 'body must be a non-empty string' }, 400);
    }
    const body = record.body.trim();

    const messageId = crypto.randomUUID();
    const aiRunId = crypto.randomUUID();
    const idempotencyKey = await computeIdempotencyKey(messageId, 'deep_dive', PROMPT_VERSION);

    const { messageNumber } = await insertHumanMessageWithQueuedRun({
      db: context.env.DB as unknown as Parameters<typeof insertHumanMessageWithQueuedRun>[0]['db'],
      message: {
        id: messageId,
        consultationId,
        authorId: session.user.id,
        body,
      },
      aiRun: {
        id: aiRunId,
        idempotencyKey,
        model: AI_MODEL,
        promptVersion: PROMPT_VERSION,
      },
      queuedEventId: crypto.randomUUID(),
    });

    (context.executionCtx as WaitUntilCapable).waitUntil(
      dispatchWithRunLifecycle(
        context.env.AGENT,
        context.env.DB,
        context.env.INTERNAL_CALLBACK_KEY,
        aiRunId,
      ).catch(logDispatchFailure),
    );

    return context.json({ id: messageId, message_number: messageNumber, ai_run: { id: aiRunId } }, 201);
  })
  .patch('/:id', jsonBodyLimit(BODY_LIMITS.publicSmall), async (context) => {
    const consultationId = context.req.param('id');
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const raw = await context.req.json<unknown>().catch(() => null);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return context.json({ error: 'invalid payload' }, 400);
    const record = raw as Record<string, unknown>;
    const extraKeys = Object.keys(record).filter((k) => k !== 'status');
    if (extraKeys.length > 0) return context.json({ error: 'server-owned fields are not allowed' }, 400);
    const status = record.status;
    if (status !== 'open' && status !== 'resolved') return context.json({ error: 'status must be open or resolved' }, 400);

    await updateConsultationStatus(context.env.DB, consultationId, status, session.user.id);
    return context.json({ id: consultationId, status });
  });
