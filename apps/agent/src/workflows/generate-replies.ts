import type { FlueContext, WorkflowRouteHandler } from '@flue/runtime';

const DEFAULT_MODEL = '@cf/openai/gpt-oss-120b';
const TIMEOUT_MS = 45_000;
const MIN_QUESTION_COUNT = 1;
const MAX_QUESTION_COUNT = 3;
const MIN_OPTION_COUNT = 3;
const MAX_OPTION_COUNT = 4;
const MAX_QUESTION_LENGTH = 160;
const MAX_OPTION_LENGTH = 80;
const MAX_TURN_BODY_LENGTH = 12_000;
const PROHIBITED_PRODUCT_TERMS = [
  '\u672c\u97f3',
  '\u30e1\u30f3\u30bf\u30eb\u30b1\u30a2',
  '\u30a8\u30f3\u30b2\u30fc\u30b8\u30e1\u30f3\u30c8',
] as const;

const FALLBACK_TURN: SessionTurnOutput = {
  quote_span: '困っていること',
  response_text: 'いまの材料だけだと少し拾いきれなかったので、まずは詰まっている場面を小さく分けて確認します。',
  questions: [
    {
      question: 'いま一番近いのはどれですか？',
      options: ['何から手をつけるか迷っている', '誰に聞けばいいか迷っている', '状況を説明する言葉がまだない'],
    },
  ],
};

const SYSTEM_PROMPT = `あなたはG's Academyの受講生の相談を支援するAIです。

役割:
- 受講生の困りごとを、質問と選択肢で引き出す
- 認識を整理し、可能性を並べる
- 判断や説教はしない。答えを出さない
- 材料を並べて、本人が自分の言葉を掴むのを手伝う
- 誰に相談すればいいかの候補を材料として並べる（チューター/メンター/同期/外部）
- 最後に選ぶのは本人。AIは決めない

対話の進め方:
- 初手は答えやすい具体的な問いから入る
- 受講生の言葉をquote_spanでそのまま引用する
- response_textでは、本人の発話を踏まえて認識を整理し、可能性を並べる
- 1ターンに2〜3個まで質問を出してよい
- 各質問に3〜4個の選択肢を付ける
- 10ターン前後に見えたら、続ける選択肢と整理へ進む選択肢の両方を出す

禁止:
- 判断・説教・答えの提示
- 安易な励まし（「大丈夫ですよ」「頑張ってますね」等）
- 感情の断定（「つらいですよね」「悩んでいますね」等）
- 以下の語の使用: ${PROHIBITED_PRODUCT_TERMS.map((term) => `「${term}」`).join('、')}

出力形式（厳守。JSON以外の出力は禁止）:
{
  "quote_span": "受講生の言葉をそのまま引用",
  "response_text": "認識の整理と可能性の提示",
  "questions": [
    {"question": "質問文", "options": ["選択肢1", "選択肢2", "選択肢3"]}
  ]
}`;

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

type QuestionWithOptions = {
  question: string;
  options: string[];
};

type SessionTurnOutput = {
  quote_span: string;
  response_text: string;
  questions: QuestionWithOptions[];
};

type RunResult = {
  turnCreated: true;
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
    let decoded = decodeSessionTurnOutput(aiResult.text);

    if (!decoded.ok) {
      await callbackToApi(env.API, input.aiRunId, 'repairing', callbackKey);
      aiResult = await runWorkersAi(env.AI, DEFAULT_MODEL, buildRepairPrompt(decoded.issues, aiResult.text));
      lastModel = aiResult.model;
      accumulateUsage(totalUsage, aiResult.usage);
      decoded = decodeSessionTurnOutput(aiResult.text);
    }

    const turnOutput = decoded.ok ? decoded.value : FALLBACK_TURN;
    const messageBody = JSON.stringify(turnOutput);
    const resultHash = await computeHash(messageBody);

    await callbackToApi(env.API, input.aiRunId, 'complete', callbackKey, {
      protocolVersion: '1',
      aiRunId: input.aiRunId,
      stage: input.context.stage,
      promptVersion: input.context.promptVersion,
      model: lastModel,
      resultHash,
      messages: [{ body: messageBody }],
      usage: {
        inputTokens: totalUsage.input,
        outputTokens: totalUsage.output,
        cacheReadTokens: totalUsage.cacheRead,
        cacheWriteTokens: totalUsage.cacheWrite,
      },
    });

    return {
      turnCreated: true,
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
  const apiResponse = await api.fetch(
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
    if (!apiResponse.ok) {
      throw new SafeWorkflowError(
        action === 'fail' ? 'AI_RUN_FAILED' : `AI_CALLBACK_${action.toUpperCase()}_FAILED`,
      );
    }
  } finally {
    await apiResponse.body?.cancel().catch(() => undefined);
  }
}

function buildPrompt(input: DispatchPayload): string {
  const ctx = input.context;
  const history = ctx.recentMessages
    .map((m) => `${m.messageNumber}. ${formatAuthor(m.authorType)}: ${formatMessageBody(m.body, m.authorType)}`)
    .join('\n');
  const humanTurns = ctx.recentMessages.filter((m) => m.authorType !== 'ai').length + 1;

  return [
    `相談タイトル: ${ctx.consultation.title}`,
    history ? `これまでの対話:\n${history}` : 'これまでの対話: まだありません',
    `今回のメッセージ: ${ctx.sourceMessage.body}`,
    `現在の受講生ターン数: ${humanTurns}`,
    '上記を踏まえて、認識を整理し、次に話しやすくなる質問と選択肢を出してください。',
  ].join('\n\n');
}

function buildRepairPrompt(issues: string[], output: string): string {
  return [
    '直前の出力を契約に合わせて修正してください。説明は書かず、JSONオブジェクトだけを返してください。',
    `問題: ${issues.join('; ')}`,
    '{"quote_span":"受講生の言葉","response_text":"認識の整理と可能性の提示","questions":[{"question":"質問文","options":["選択肢1","選択肢2","選択肢3"]}]}',
    output,
  ].join('\n\n');
}

async function runWorkersAi(ai: WorkersAiBinding, model: string, prompt: string): Promise<{
  model: string;
  text: string;
  usage: Partial<{ input: number; output: number; cacheRead: number; cacheWrite: number }>;
}> {
  const aiResult = await withTimeout(
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
    text: extractText(aiResult),
    usage: extractUsage(aiResult),
  };
}

function decodeSessionTurnOutput(textValue: string):
  | { ok: true; value: SessionTurnOutput }
  | { ok: false; issues: string[] } {
  let value: unknown;
  try {
    value = JSON.parse(extractJsonObject(textValue));
  } catch {
    return { ok: false, issues: ['valid JSON required'] };
  }
  if (!isRecord(value)) return { ok: false, issues: ['JSON object required'] };

  const issues: string[] = [];
  const quoteSpan = typeof value.quote_span === 'string' ? value.quote_span.trim() : '';
  const responseText = typeof value.response_text === 'string' ? value.response_text.trim() : '';
  const rawQuestions = Array.isArray(value.questions) ? value.questions : [];

  if (!quoteSpan) issues.push('quote_span required');
  if (!responseText) issues.push('response_text required');
  if (rawQuestions.length < MIN_QUESTION_COUNT || rawQuestions.length > MAX_QUESTION_COUNT) {
    issues.push(`questions length must be ${MIN_QUESTION_COUNT}-${MAX_QUESTION_COUNT}`);
  }

  const questions: QuestionWithOptions[] = [];
  for (const rawQuestion of rawQuestions) {
    if (!isRecord(rawQuestion)) {
      issues.push('each question must be an object');
      continue;
    }
    const question = typeof rawQuestion.question === 'string' ? rawQuestion.question.trim() : '';
    const rawOptions = Array.isArray(rawQuestion.options) ? rawQuestion.options : [];
    const options = rawOptions
      .filter((option): option is string => typeof option === 'string')
      .map((option) => option.trim())
      .filter(Boolean);

    if (!question) issues.push('question text required');
    if (question.length > MAX_QUESTION_LENGTH) issues.push('question text too long');
    if (options.length !== rawOptions.length) issues.push('all options must be strings');
    if (options.length < MIN_OPTION_COUNT || options.length > MAX_OPTION_COUNT) {
      issues.push(`options length must be ${MIN_QUESTION_COUNT}-${MAX_OPTION_COUNT}`);
    }
    if (options.some((option) => option.length > MAX_OPTION_LENGTH)) issues.push('option text too long');
    questions.push({ question, options });
  }

  const normalized: SessionTurnOutput = { quote_span: quoteSpan, response_text: responseText, questions };
  if (JSON.stringify(normalized).length > MAX_TURN_BODY_LENGTH) issues.push('turn body too long');
  if (issues.length > 0) return { ok: false, issues };
  return { ok: true, value: normalized };
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

function formatMessageBody(body: string, authorType: string): string {
  if (authorType !== 'ai') return body;
  try {
    const parsed = JSON.parse(body);
    if (!isRecord(parsed)) return body;
    const quote = typeof parsed.quote_span === 'string' ? `引用: ${parsed.quote_span}` : '';
    const text = typeof parsed.response_text === 'string' ? `整理: ${parsed.response_text}` : '';
    return [quote, text].filter(Boolean).join(' / ') || body;
  } catch {
    return body;
  }
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
