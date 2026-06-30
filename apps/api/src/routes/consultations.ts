import { Hono } from 'hono';
import {
  getConsultationDetail,
  getSharedReport,
  getUserRole,
  listVisibleConsultations,
  normalizeVisibility,
  updateConsultationStatus,
} from '@aimani-gs/db';
import type { ConsultationDetail, Message, ReportShareTarget } from '@aimani-gs/contracts';
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
const PROMPT_VERSION = 'phase2-chat-v1';
const MAX_HUMAN_TURNS = 20;

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
    const agentResponse = await agent.fetch(
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
            replyCount: 1,
            promptVersion: PROMPT_VERSION,
            stage: ctx.aiRun.stage,
          },
        }),
      }),
    );

    try {
      if (!agentResponse.ok) throw new Error(`Workflow dispatch failed with ${agentResponse.status}`);
    } finally {
      await agentResponse.body?.cancel().catch(() => undefined);
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeShareTarget(value: unknown): ReportShareTarget | null {
  return value === 'tutor' || value === 'mentor' ? value : null;
}

function humanTurnCount(messages: Message[]): number {
  return messages.filter((message) => message.author_type !== 'ai').length;
}

function buildPersonalReport(detail: ConsultationDetail): string {
  const aiInsights = detail.messages
    .filter((message) => message.author_type === 'ai')
    .map((message) => {
      try {
        const parsed = JSON.parse(message.body);
        if (!isRecord(parsed)) return '';
        const quote = typeof parsed.quote_span === 'string' && parsed.quote_span.trim()
          ? `> ${parsed.quote_span.trim()}`
          : '';
        const text = typeof parsed.response_text === 'string' ? parsed.response_text.trim() : '';
        return [quote, text].filter(Boolean).join('\n');
      } catch {
        return '';
      }
    })
    .filter(Boolean);

  return [
    `# ${detail.title}`,
    '',
    '## 困っていること',
    detail.body,
    '',
    '## 整理で見えてきたこと',
    aiInsights.join('\n\n') || 'まだ材料が少ない状態です。',
  ].join('\n');
}

function buildSharedReport(personalReport: string, target: ReportShareTarget): string {
  const targetLabel = target === 'tutor' ? 'チューター' : 'メンター';
  const bodyMatch = personalReport.match(/## 困っていること\n([\s\S]*?)(?=\n##|$)/);
  const bodyText = bodyMatch?.[1]?.trim() || '';
  return [
    `# ${targetLabel}に相談したいこと`,
    '',
    bodyText || '（概要を入力してください）',
    '',
    '## 相談したいこと',
    '- （ここを編集してください）',
  ].join('\n');
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
  .get('/:id/shared', async (context) => {
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const role = await getUserRole(context.env.DB, session.user.id);
    const sharedReport = await getSharedReport(context.env.DB, context.req.param('id'), {
      userId: session.user.id,
      role,
    });
    if (!sharedReport) return context.json({ error: 'not found' }, 404);

    return context.json(sharedReport);
  })
  .post('/', jsonBodyLimit(BODY_LIMITS.publicLarge), async (context) => {
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const input = await context.req.json<Record<string, unknown>>().catch(() => null);
    if (!input || typeof input !== 'object') return context.json({ error: 'invalid JSON body' }, 400);

    const allowedFields = new Set(['title', 'body', 'visibility']);
    const unexpected = Object.keys(input).filter((key) => !allowedFields.has(key));
    if (unexpected.length > 0) return context.json({ error: `unexpected fields: ${unexpected.join(', ')}` }, 400);

    const body = input.body;
    const rawTitle = input.title;
    const visibility = normalizeVisibility(input.visibility ?? 'private');
    if (typeof body !== 'string') return context.json({ error: 'body must be a string' }, 400);
    if (rawTitle !== undefined && typeof rawTitle !== 'string') return context.json({ error: 'title must be a string' }, 400);
    if (!visibility) return context.json({ error: 'visibility is invalid' }, 400);

    const trimmedBody = body.trim();
    const trimmedTitle = (rawTitle?.trim() || trimmedBody.slice(0, 40) || '新しい相談').trim();
    if (!trimmedBody) return context.json({ error: 'body must not be empty' }, 400);

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
    if (humanTurnCount(readable.messages) >= MAX_HUMAN_TURNS) {
      return context.json({ error: 'turn limit reached' }, 409);
    }

    const raw = await context.req.json<unknown>().catch(() => null);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return context.json({ error: 'invalid payload' }, 400);
    const record = raw as Record<string, unknown>;
    const extraKeys = Object.keys(record).filter((key) => key !== 'body');
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
  .post('/:id/reports', jsonBodyLimit(BODY_LIMITS.publicLarge), async (context) => {
    const consultationId = context.req.param('id');
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const detail = await getConsultationDetail(context.env.DB, consultationId, { userId: session.user.id, role: 'student' });
    if (!detail || detail.user_id !== session.user.id) return context.json({ error: 'not found' }, 404);

    const raw = await context.req.json<unknown>().catch(() => ({}));
    const record = isRecord(raw) ? raw : {};
    const target = normalizeShareTarget(record.shared_with);
    const personalReport = typeof record.personal_report === 'string' && record.personal_report.trim()
      ? record.personal_report.trim()
      : detail.personal_report || buildPersonalReport(detail);
    const sharedReport = target
      ? (typeof record.shared_report === 'string' && record.shared_report.trim()
          ? record.shared_report.trim()
          : detail.shared_report || buildSharedReport(personalReport, target))
      : null;
    const shareNow = record.share_now === true && target && sharedReport;

    await context.env.DB.prepare(
      [
        'UPDATE consultations',
        'SET personal_report = ?, shared_report = ?, shared_with = ?,',
        `shared_at = CASE WHEN ? THEN strftime('%Y-%m-%dT%H:%M:%fZ', 'now') ELSE NULL END,`,
        `updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')`,
        'WHERE id = ? AND user_id = ?',
      ].join(' '),
    ).bind(
      personalReport,
      sharedReport,
      target,
      shareNow ? 1 : 0,
      consultationId,
      session.user.id,
    ).run();

    return context.json({
      id: consultationId,
      personal_report: personalReport,
      shared_report: sharedReport,
      shared_with: target,
      shared_at: shareNow ? 'shared' : null,
    });
  })
  .patch('/:id', jsonBodyLimit(BODY_LIMITS.publicSmall), async (context) => {
    const consultationId = context.req.param('id');
    const session = await getSessionForRequest(context);
    const authError = authErrorResponse(session);
    if (authError) return context.json(authError.body, authError.status);

    const raw = await context.req.json<unknown>().catch(() => null);
    if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) return context.json({ error: 'invalid payload' }, 400);
    const record = raw as Record<string, unknown>;
    const extraKeys = Object.keys(record).filter((key) => key !== 'status');
    if (extraKeys.length > 0) return context.json({ error: 'server-owned fields are not allowed' }, 400);
    const status = record.status;
    if (status !== 'open' && status !== 'resolved') return context.json({ error: 'status must be open or resolved' }, 400);

    await updateConsultationStatus(context.env.DB, consultationId, status, session.user.id);
    return context.json({ id: consultationId, status });
  });
