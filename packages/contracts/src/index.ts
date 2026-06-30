// aimani-gs データモデル・API境界型定義

/** ユーザーロール */
export type UserRole = 'student' | 'tutor' | 'mentor';

/** 相談の公開範囲 */
export type ConsultationVisibility =
  | 'private'
  | 'tutor'
  | 'mentor'
  | 'public';

/** 相談ステータス */
export type ConsultationStatus = 'open' | 'resolved';

/** メッセージの発信者種別 */
export type AuthorType = 'student' | 'tutor' | 'mentor' | 'ai';

export type ReportShareTarget = 'tutor' | 'mentor';

/** AIが1ターンで返す質問と選択肢 */
export type QuestionWithOptions = {
  question: string;
  options: string[];
};

/** AIが1ターンで返す構造化出力。author_type='ai' の messages.body にJSON文字列で保存する。 */
export type SessionTurnOutput = {
  quote_span: string;
  response_text: string;
  questions: QuestionWithOptions[];
};

/** 相談 */
export type Consultation = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  visibility: ConsultationVisibility;
  status: ConsultationStatus;
  personal_report: string | null;
  shared_report: string | null;
  shared_with: ReportShareTarget | null;
  shared_at: string | null;
  created_at: string;
  updated_at: string;
};

/** メッセージ */
export type Message = {
  id: string;
  consultation_id: string;
  message_number: number;
  author_type: AuthorType;
  author_id: string | null;
  body: string;
  parent_message_id: string | null;
  created_at: string;
};

/** 相談作成入力 */
export type CreateConsultationInput = {
  title?: string;
  body: string;
  visibility: ConsultationVisibility;
};

/** メッセージ作成入力 */
export type CreateMessageInput = {
  body: string;
};

/** API共通エラー */
export type ApiError = { error: string };

/** 相談詳細（メッセージ付き） */
export type ConsultationDetail = Consultation & { messages: Message[] };

/** 相談作成レスポンス */
export type CreateConsultationResponse = {
  id: string;
  title: string;
  ai_run: { id: string };
};

/** メッセージ作成レスポンス */
export type CreateMessageResponse = {
  id: string;
  message_number: number;
  ai_run: { id: string };
};

export type SaveReportInput = {
  personal_report: string;
  shared_report?: string | null;
  shared_with?: ReportShareTarget | null;
  share_now?: boolean;
};

export type SharedReportView = {
  id: string;
  title: string;
  shared_report: string;
  shared_with: ReportShareTarget;
  shared_at: string | null;
};

// ── AI run SSE ──────────────────────────────────────────

/** 公開境界で許可する error code。runtime 配列から型を導出。 */
export const PUBLIC_AI_ERROR_CODES = [
  'AI_CONFIGURATION_ERROR',
  'AI_PROVIDER_TIMEOUT',
  'AI_OUTPUT_INVALID',
  'AI_INPUT_INVALID',
  'AI_RUN_FAILED',
  'AI_DISPATCH_FAILED',
  'AI_EVENT_INVALID',
] as const;

export type PublicAiErrorCode = (typeof PUBLIC_AI_ERROR_CODES)[number];

const publicAiErrorCodeSet = new Set<PublicAiErrorCode>(PUBLIC_AI_ERROR_CODES);

export function isPublicAiErrorCode(value: unknown): value is PublicAiErrorCode {
  return typeof value === 'string' && publicAiErrorCodeSet.has(value as PublicAiErrorCode);
}

/** 公開SSEで配信する allow-list 済みイベント */
export type PublicAiRunEvent =
  | { status: 'queued' | 'admitted' | 'generating' | 'repairing' }
  | { status: 'completed'; message_ids: readonly string[] }
  | { status: 'failed'; error_code: PublicAiErrorCode };

/** useAiRunProgress の状態。connection_failed は Web 専用。 */
export type AiRunProgress =
  | { status: 'idle' }
  | { status: 'connecting' }
  | { status: 'reconnecting' }
  | { status: 'connection_failed' }
  | { status: 'queued' | 'admitted' | 'generating' | 'repairing' }
  | { status: 'completed'; messageIds: readonly string[] }
  | { status: 'failed'; errorCode: PublicAiErrorCode };
