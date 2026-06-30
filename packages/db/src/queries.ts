import type {
  Consultation,
  ConsultationDetail,
  ConsultationStatus,
  ConsultationVisibility,
  Message,
  UserRole,
} from '@aimani-gs/contracts';

const VALID_VISIBILITIES = new Set<ConsultationVisibility>([
  'private',
  'tutor',
  'mentor',
  'public',
]);

export async function getUserRole(db: D1Database, userId: string): Promise<UserRole> {
  const row = await db
    .prepare('SELECT role FROM user_roles WHERE user_id = ?')
    .bind(userId)
    .first<{ role: UserRole }>();
  return row?.role ?? 'student';
}

export async function listVisibleConsultations(
  db: D1Database,
  viewer?: { userId: string; role: UserRole } | null,
): Promise<Consultation[]> {
  if (!viewer) {
    const result = await db
      .prepare("SELECT * FROM consultations WHERE visibility = 'public' ORDER BY created_at DESC")
      .all<Consultation>();
    return result.results;
  }

  const canSeeTutor = viewer.role === 'tutor';
  const canSeeMentor = viewer.role === 'mentor';
  const result = await db
    .prepare(
      [
        'SELECT * FROM consultations',
        'WHERE user_id = ?',
        "OR visibility = 'public'",
        canSeeTutor ? "OR visibility = 'tutor'" : '',
        canSeeMentor ? "OR visibility = 'mentor'" : '',
        'ORDER BY created_at DESC',
      ].filter(Boolean).join(' '),
    )
    .bind(viewer.userId)
    .all<Consultation>();

  return result.results;
}

export async function getConsultationDetail(
  db: D1Database,
  consultationId: string,
  viewer?: { userId: string; role: UserRole } | null,
): Promise<ConsultationDetail | null> {
  const consultation = await db
    .prepare('SELECT * FROM consultations WHERE id = ?')
    .bind(consultationId)
    .first<Consultation>();

  if (!consultation) return null;
  if (!canReadConsultation(consultation, viewer)) return null;

  const messages = await db
    .prepare(
      'SELECT * FROM messages WHERE consultation_id = ? ORDER BY message_number ASC',
    )
    .bind(consultationId)
    .all<Message>();

  return { ...consultation, messages: messages.results };
}

export async function updateConsultationStatus(
  db: D1Database,
  consultationId: string,
  status: ConsultationStatus,
  userId: string,
): Promise<void> {
  await db
    .prepare(
      [
        'UPDATE consultations',
        "SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')",
        'WHERE id = ? AND user_id = ?',
      ].join(' '),
    )
    .bind(status, consultationId, userId)
    .run();
}

export function normalizeVisibility(value: unknown): ConsultationVisibility | null {
  if (typeof value !== 'string') return null;
  return VALID_VISIBILITIES.has(value as ConsultationVisibility)
    ? (value as ConsultationVisibility)
    : null;
}

function canReadConsultation(
  consultation: Consultation,
  viewer?: { userId: string; role: UserRole } | null,
): boolean {
  if (consultation.visibility === 'public') return true;
  if (!viewer) return false;
  if (consultation.user_id === viewer.userId) return true;
  if (consultation.visibility === 'tutor' && viewer.role === 'tutor') return true;
  if (consultation.visibility === 'mentor' && viewer.role === 'mentor') return true;
  return false;
}
