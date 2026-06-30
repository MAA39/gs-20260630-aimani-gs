// aimani-gs データモデル型定義

/** ユーザーロール */
export type UserRole = 'student' | 'tutor' | 'mentor';

/** 相談の公開範囲 */
export type ConsultationVisibility =
  | 'private'     // 自分だけ
  | 'tutor'       // 指定チューターに共有
  | 'mentor'      // 指定メンターに共有
  | 'public';     // 全体公開

/** 相談ステータス */
export type ConsultationStatus = 'open' | 'resolved';

/** メッセージの発信者種別 */
export type AuthorType = 'student' | 'tutor' | 'mentor' | 'ai';

/** 相談（旧thread） */
export type Consultation = {
  id: string;
  user_id: string;
  title: string;
  body: string;
  visibility: ConsultationVisibility;
  status: ConsultationStatus;
  created_at: string;
  updated_at: string;
};

/** メッセージ（旧post） */
export type Message = {
  id: string;
  consultation_id: string;
  message_number: number;
  author_type: AuthorType;
  author_id: string | null; // AIの場合null
  body: string;
  created_at: string;
};

/** 相談作成入力 */
export type CreateConsultationInput = {
  title: string;
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
