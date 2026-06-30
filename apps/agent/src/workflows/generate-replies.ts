import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';

const DEFAULT_MODEL = '@cf/openai/gpt-oss-120b';
const REPLY_COUNT = 3;
const TIMEOUT_MS = 45_000;

const MIN_RESPONSES = 1;
const MAX_RESPONSES = 5;
const MIN_RESPONSE_LENGTH = 1;
const MAX_RESPONSE_LENGTH = 500;

const FALLBACK_RESPONSES = [
  '少し整理しきれませんでした。まず「何に一番時間を使っているか」と「どこで止まっているか」だけ短く書いてみると、次の相談にしやすくなります。',
];

const SYSTEM_PROMPT = `あなたはG's Academyの受講生の相談を支援するAIです。

以下のルールを守ってください:
- 判断や説教をしない。答えを出さない
- 困りごとを具体的な問いで引き出す（「最近一番時間を使ったことは？」等）
- 感情を否定しない。事実と解釈を分けて整理する
- 材料を並べて、本人が自分の言葉を掴むのを手伝う
- 「誰に相談すればいいか」の候補を材料として並べる（チューター/メンター/同期/外部）
- 最後に選ぶのは本人。AIは決めない

出力形式: {"responses":["応答1","応答2","応答3"]}`;

type DispatchPayload = {
  aiRunId: string;
  context: {
    consultation: {
      id: string;
      user_id: string;
      title: string;
      body: string;
      visibility: string;
    };
    sourceMessage: {
      id: string;
      messageNumber: number;
      authorType: string;
      body: string;
    };
    recentMessages: Array<{
      messageNumber: number;
      authorType: string;
      body: string;
    }>;
    replyCount: number;
    promptVersion: string;
    stage: string;
  };
};

type WorkersAiBinding = {
  run(model: string, input: unknown): Promise<unknown>;
};

type Env = {
  API: { fetch: typeof fetch };
  AI: WorkersAiBinding;
  INTERNAL_CALLBACK_KEY?: string;
};

type ResponseBundle = { responses: string[] };

type RunResult = {
  responsesCount: number;
  model: { provider: 'workers-ai'; id: string };
  usage: { input: number; output: number };
};

class SafeWorkflowError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = 'SafeWorkflowError';
  }
}

const SAFE_ERROR_MESSAGES: Record<string, string> = {
  AI_CONFIGURATION_ERROR: 'Agent configuration missing or invalid',
  AI_PROVIDER_TIMEOUT: 'AI provider did not respond within time limit',
  AI_OUTPUT_INVALID: 'AI output failed validation after repair attempt',
  AI_INPUT_INVALID: 'Dispatch payload missing required fields',
  AI_RUN_FAILED: 'AI workflow encountered an unexpected error',
  AI_DISPATCH_FAILED: 'Workflow dispatch failed',
};

export const route: WorkflowRouteHandler = async (_context, next) => next();

export async function run({ payload, env }: FlueContext<unknown, Env>): Promise<RunResult> {
  const input = parsePayload(payload);
  const callbackKey = env.INTERNAL_CALLBACK_KEY?.trim();
  if (!callbackKey) throw new SafeWorkflowError('AI_CONFIGURATION_ERROR');
  if (!env.AI) throw new SafeWorkflowError('AI_CONFIGURATION_ERROR');

  const totalUsage = { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 };
  let lastModel = DEFAULT_MODEL;

  try {
    await callbackToApi(env.API, input.aiRunId, 'generating', callbackKey);

    let aiResult = await runWorkersAi(env.AI, DEFAULT_MODEL, buildPrompt(input));
    lastModel = aiResult.model;
    accumulateUsage(totalUsage, aiResult.usage);
    let decoded = decodeResponses(aiResult.text);

    if (!decoded.ok) {
      await callbackToApi(env.API, input.aiRunId, 'repairing', callbackKey);
      aiResult = await runWorkersAi(env.AI, DEFAULT_MODEL, buildRepairPrompt(decoded.issues, aiResult.text));
      lastModel = aiResult.model;
      accumulateUsage(totalUsage, aiResult.usage);
      decoded = decodeResponses(aiResult.text);
    }

    if (!decoded.ok) {
      decoded = { ok: true, value: { responses: FALLBACK_RESPONSES } };
    }

    const resultHash = await computeHash(JSON.stringify(decoded.value.responses));

    await callbackToApi(env.API, input.aiRunId, 'complete', callbackKey, {
      protocolVersion: '1',
      aiRunId: input.aiRunId,
      stage: input.context.stage,
      promptVersion: input.context.promptVersion,
      model: lastModel,
      resultHash,
      replies: decoded.value.responses.map((body) => ({ body })),
      usage: {
        inputTokens: totalUsage.input,
        outputTokens: totalUsage.output,
        cacheReadTokens: totalUsage.cacheRead,
        cacheWriteTokens: totalUsage.cacheWrite,
      },
    });

    return {
      responsesCount: decoded.value.responses.length,
      model: { provider: 'workers-ai', id: lastModel },
      usage: { input: totalUsage.input, output: totalUsage.output },
    };
  } catch (error) {
    const errorCode = toSafeErrorCode(error);
    await callbackToApi(env.API, input.aiRunId, 'fail', callbackKey, {
      errorCode,
      errorMessage: SAFE_ERROR_MESSAGES[errorCode] || 'AI workflow encountered an unexpected error',
    }).catch(() => undefined);

    throw new SafeWorkflowError(errorCode);
  }
}

async function callbackToApi(
  api: { fetch: typeof fetch },
  aiRunId: string,
  action: 'generating' | 'repairing' | 'complete' | 'fail',
  callbackKey: string,
  body?: Record<string, unknown>,
): Promise<void> {
  const response = await api.fetch(
    new Request(`http://api/internal/v1/ai-runs/${aiRunId}/${action}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Callback-Key': callbackKey,
      },
      body: body ? JSON.stringify(body) : '{}',
    }),
  );

  try {
    if (!response.ok) {
      throw new SafeWorkflowError(
        action === 'fail' ? 'AI_RUN_FAILED' : `AI_CALLBACK_${action.toUpperCase()}_FAILED`,
      );
    }
  } finally {
    await response.body?.cancel().catch(() => undefined);
  }
}

function buildPrompt(input: DispatchPayload): string {
  const ctx = input.context;
  const history = ctx.recentMessages
    .map((m) => `${m.messageNumber}. ${formatAuthor(m.authorType)}: ${m.body}`)
    .join('\n');

  return [
    `相談タイトル: ${ctx.consultation.title}`,
    `公開範囲: ${ctx.consultation.visibility}`,
    history ? `これまでの流れ:\n${history}` : 'これまでの流れ: まだありません',
    `今回整理したい内容: ${ctx.sourceMessage.body}`,
    `応答を${ctx.replyCount || REPLY_COUNT}件返してください。`,
    '各応答は、本人が次に書きやすくなる短い材料・問い・整理だけにしてください。',
  ].join('\n\n');
}

function buildRepairPrompt(issues: string[], output: string): string {
  return [
    '直前の出力を契約に合わせて修正してください。説明は書かず、JSONオブジェクトだけを返してください。',
    `問題: ${issues.join('; ')}`,
    '{"responses":["応答1","応答2","応答3"]}',
    output,
  ].join('\n\n');
}

async function runWorkersAi(ai: WorkersAiBinding, model: string, prompt: string): Promise<{
  model: string;
  text: string;
  usage: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>;
}> {
  const result = await withTimeout(
    ai.run(model, {
      messages: [
        { role: 'system', content: SYSTEM_PROMPT },
        { role: 'user', content: prompt },
      ],
    }),
    TIMEOUT_MS,
  );

  return {
    model,
    text: extractText(result),
    usage: extractUsage(result),
  };
}

function decodeResponses(textValue: string):
  | { ok: true; value: ResponseBundle }
  | { ok: false; issues: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(textValue));
  } catch {
    return { ok: false, issues: ['valid JSON required'] };
  }
  if (!isRecord(value)) return { ok: false, issues: ['JSON object required'] };

  const rawResponses = Array.isArray(value.responses)
    ? value.responses
    : Array.isArray(value.replies)
      ? value.replies
      : null;
  if (!rawResponses) return { ok: false, issues: ['responses array required'] };

  const issues: string[] = [];
  if (rawResponses.length < MIN_RESPONSES || rawResponses.length > MAX_RESPONSES) {
    issues.push(`expected ${MIN_RESPONSES}-${MAX_RESPONSES} responses`);
  }

  const responses = rawResponses
    .filter((r): r is string => typeof r === 'string')
    .map((r) => r.trim());
  if (responses.length !== rawResponses.length) issues.push('all responses must be strings');
  if (responses.some((r) => r.length < MIN_RESPONSE_LENGTH || r.length > MAX_RESPONSE_LENGTH)) {
    issues.push(`response length must be ${MIN_RESPONSE_LENGTH}-${MAX_RESPONSE_LENGTH}`);
  }
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: { responses } };
}

function parsePayload(value: unknown): DispatchPayload {
  if (!isRecord(value)) throw new SafeWorkflowError('AI_INPUT_INVALID');
  if (typeof value.aiRunId !== 'string' || !isRecord(value.context)) {
    throw new SafeWorkflowError('AI_INPUT_INVALID');
  }
  return value as DispatchPayload;
}

async function computeHash(content: string): Promise<string> {
  const encoded = new TextEncoder().encode(content);
  const hash = await crypto.subtle.digest('SHA-256', encoded);
  return Array.from(new Uint8Array(hash))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

function toSafeErrorCode(error: unknown): string {
  if (error instanceof SafeWorkflowError) return error.code;
  if (error instanceof DOMException && error.name === 'TimeoutError') return 'AI_PROVIDER_TIMEOUT';
  if (error instanceof Error && /timeout/iu.test(error.message)) return 'AI_PROVIDER_TIMEOUT';
  return 'AI_RUN_FAILED';
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<never>((_, reject) => {
      setTimeout(() => reject(new DOMException('AI provider timeout', 'TimeoutError')), ms);
    }),
  ]);
}

function extractText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (!isRecord(value)) return '';

  for (const key of ['response', 'output_text', 'text']) {
    const candidate = value[key];
    if (typeof candidate === 'string') return candidate;
  }

  const result = value.result;
  if (isRecord(result)) {
    for (const key of ['response', 'output_text', 'text']) {
      const candidate = result[key];
      if (typeof candidate === 'string') return candidate;
    }
  }

  const choices = value.choices;
  if (Array.isArray(choices) && isRecord(choices[0])) {
    const first = choices[0];
    const message = first.message;
    if (isRecord(message) && typeof message.content === 'string') return message.content;
    if (typeof first.text === 'string') return first.text;
  }

  return '';
}

function extractUsage(value: unknown): Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }> {
  const usage = isRecord(value) && isRecord(value.usage) ? value.usage : null;
  if (!usage) return {};
  return {
    input: numberFrom(usage.input_tokens ?? usage.prompt_tokens ?? usage.inputTokens),
    output: numberFrom(usage.output_tokens ?? usage.completion_tokens ?? usage.outputTokens),
    cacheRead: numberFrom(usage.cache_read_tokens ?? usage.cacheReadTokens),
    cacheWrite: numberFrom(usage.cache_write_tokens ?? usage.cacheWriteTokens),
  };
}

function accumulateUsage(
  total: { input: number; output: number; cacheRead: number; cacheWrite: number },
  usage: Partial<typeof total>,
): void {
  total.input += nonNegative(usage.input);
  total.output += nonNegative(usage.output);
  total.cacheRead += nonNegative(usage.cacheRead);
  total.cacheWrite += nonNegative(usage.cacheWrite);
}

function numberFrom(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? Math.trunc(value) : undefined;
}

function nonNegative(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

function extractJsonObject(text: string): string {
  const trimmed = text.trim();
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) return trimmed;
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) return trimmed.slice(start, end + 1);
  return trimmed;
}

function formatAuthor(authorType: string): string {
  switch (authorType) {
    case 'student': return '受講生';
    case 'tutor': return 'チューター';
    case 'mentor': return 'メンター';
    case 'ai': return 'AI';
    default: return '参加者';
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}
