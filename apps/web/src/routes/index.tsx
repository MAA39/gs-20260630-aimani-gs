import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  Consultation,
  ConsultationVisibility,
  CreateConsultationResponse,
} from '@aimani-gs/contracts';
import { getAuthenticatedApi } from '../lib/api-fetch';
import { signInWithGitHub } from '../lib/auth-client';

const visibilityLabels: Record<ConsultationVisibility, string> = {
  private: '自分だけ',
  tutor: 'チューターに見せる',
  mentor: 'メンターに見せる',
  public: '全体に出す',
};

const fetchConsultations = createServerFn({ method: 'GET' })
  .handler(async () => {
    const api = await getAuthenticatedApi();
    const res = await api('/api/v1/consultations');
    return res.ok ? (await res.json()) as Consultation[] : [];
  });

const createConsultationAction = createServerFn({ method: 'POST' })
  .validator((input: { title: string; body: string; visibility: ConsultationVisibility }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const r = await api('/api/v1/consultations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(errBody.error ?? `create consultation failed: ${r.status}`);
    }
    return (await r.json()) as CreateConsultationResponse;
  });

export const Route = createFileRoute('/')({
  loader: () => fetchConsultations(),
  component: HomePage,
});

function HomePage() {
  const initial = Route.useLoaderData();
  const navigate = useNavigate();
  const [consultations, setConsultations] = useState(initial);
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [visibility, setVisibility] = useState<ConsultationVisibility>('private');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);

  useEffect(() => { setConsultations(initial); }, [initial]);

  const handleSubmit = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    const trimmedTitle = title.trim();
    const trimmedBody = body.trim();
    if (!trimmedTitle || !trimmedBody || submitting) return;

    setSubmitting(true);
    setError('');
    try {
      const result = await createConsultationAction({
        data: { title: trimmedTitle, body: trimmedBody, visibility },
      });
      setTitle('');
      setBody('');
      setVisibility('private');
      await navigate({
        to: '/consultations/$id',
        params: { id: result.id },
        search: { run: result.ai_run.id },
      });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '相談の作成に失敗しました';
      if (message.includes('authentication required')) {
        setShowAuthModal(true);
        return;
      }
      setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [body, navigate, submitting, title, visibility]);

  return (
    <div>
      <div className="card">
        <p className="eyebrow">New consultation</p>
        <h2 style={{ marginBottom: '12px', fontFamily: 'Georgia, serif' }}>相談を作る</h2>
        <form onSubmit={handleSubmit}>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder="例: チーム開発で役割の決め方に迷っている"
            required
          />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder="何に困っているか、まだまとまっていなくても大丈夫です。今ある材料だけ書いてください。"
            required
          />
          <select value={visibility} onChange={(e) => setVisibility(e.target.value as ConsultationVisibility)}>
            {(Object.keys(visibilityLabels) as ConsultationVisibility[]).map((key) => (
              <option key={key} value={key}>{visibilityLabels[key]}</option>
            ))}
          </select>
          <button type="submit" disabled={submitting}>
            {submitting ? '作成中...' : 'AIと整理を始める'}
          </button>
        </form>
        {error && <div className="card error" style={{ marginTop: '12px', boxShadow: 'none' }}>{error}</div>}
      </div>

      <div className="section-header">
        <span>Consultations</span>
        <span>{consultations.length}件</span>
      </div>

      {consultations.map((consultation) => (
        <div key={consultation.id} className="consultation-card">
          <Link to="/consultations/$id" params={{ id: consultation.id }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', gap: '12px' }}>
              <div style={{ flex: 1 }}>
                <div className="consultation-title">{consultation.title}</div>
                <div className="consultation-preview">
                  {consultation.body.length > 80 ? `${consultation.body.slice(0, 80)}...` : consultation.body}
                </div>
              </div>
              <div style={{ display: 'grid', gap: '6px', justifyItems: 'end' }}>
                <span className="badge">{visibilityLabels[consultation.visibility]}</span>
                <span className="badge">{consultation.status === 'resolved' ? '整理済み' : '整理中'}</span>
              </div>
            </div>
          </Link>
        </div>
      ))}

      {consultations.length === 0 && (
        <div className="card" style={{ textAlign: 'center', color: '#555041' }}>
          まだ相談がありません。
        </div>
      )}

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  );
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const handleSignIn = useCallback(async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      await signInWithGitHub();
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : 'GitHubログインに失敗しました');
      setAuthLoading(false);
    }
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal-card" onClick={(e) => e.stopPropagation()}>
        <p className="eyebrow">Sign in</p>
        <h3 style={{ fontFamily: 'Georgia, serif', margin: '8px 0 16px' }}>相談を作るにはログインが必要です</h3>
        {authError && <p style={{ color: '#c53030', fontSize: '0.85rem', marginBottom: '12px' }}>{authError}</p>}
        <button onClick={handleSignIn} disabled={authLoading} style={{ width: '100%' }}>
          {authLoading ? '移動中...' : 'GitHubでログイン'}
        </button>
      </div>
    </div>
  );
}
