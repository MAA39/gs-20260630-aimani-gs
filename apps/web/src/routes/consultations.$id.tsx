import { createFileRoute, Link, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import type {
  ConsultationDetail,
  CreateMessageResponse,
  Message,
} from '@aimani-gs/contracts';
import { useAiRunProgress, getProgressLabel } from '../lib/use-ai-run-progress';
import { getAuthenticatedApi } from '../lib/api-fetch';
import { signInWithGitHub } from '../lib/auth-client';

const fetchDetail = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const r = await api(`/api/v1/consultations/${data.id}`);
    if (!r.ok) throw new Error('not found');
    return (await r.json()) as ConsultationDetail;
  });

const addMessage = createServerFn({ method: 'POST' })
  .validator((input: { consultationId: string; body: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const r = await api(`/api/v1/consultations/${data.consultationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: data.body }),
    });
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(errBody.error ?? `message failed: ${r.status}`);
    }
    return (await r.json()) as CreateMessageResponse;
  });

const updateStatus = createServerFn({ method: 'POST' })
  .validator((input: { consultationId: string; status: 'open' | 'resolved' }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const r = await api(`/api/v1/consultations/${data.consultationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: data.status }),
    });
    if (r.status === 401) {
      await r.body?.cancel().catch(() => undefined);
      throw new Error('authentication required');
    }
    if (!r.ok) {
      const errBody = await r.json().catch(() => ({})) as { error?: string };
      throw new Error(errBody.error ?? `status update failed: ${r.status}`);
    }
    await r.body?.cancel().catch(() => undefined);
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SearchParams = { run?: string };

export const Route = createFileRoute('/consultations/$id')({
  validateSearch: (s: Record<string, unknown>): SearchParams => ({
    run: typeof s.run === 'string' && UUID_RE.test(s.run) ? s.run : undefined,
  }),
  loader: async ({ params }) => {
    const detail = await fetchDetail({ data: { id: params.id } });
    return { detail };
  },
  component: ConsultationDetailPage,
});

function useSerialPolling(task: () => Promise<void>, intervalMs: number) {
  const taskRef = useRef(task);
  taskRef.current = task;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (typeof document === 'undefined' || !document.hidden) {
          await taskRef.current();
        }
      } catch { /* polling failure はUIを壊さない */ }
      finally { if (!stopped) timer = setTimeout(tick, intervalMs); }
    };
    timer = setTimeout(tick, intervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [intervalMs]);
}

function ConsultationDetailPage() {
  const { detail } = Route.useLoaderData();
  const { id: consultationId } = Route.useParams();
  const { run } = Route.useSearch();
  const navigate = useNavigate();
  return (
    <ConsultationDetailPageContent
      key={consultationId}
      consultationId={consultationId}
      initial={detail}
      aiRunId={run ?? null}
      navigate={navigate}
    />
  );
}

type ContentProps = {
  consultationId: string;
  initial: ConsultationDetail;
  aiRunId: string | null;
  navigate: ReturnType<typeof useNavigate>;
};

function ConsultationDetailPageContent({ consultationId, initial, aiRunId, navigate }: ContentProps) {
  const [consultation, setConsultation] = useState(initial);
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [showAuthModal, setShowAuthModal] = useState(false);
  const refreshVersionRef = useRef(0);

  useEffect(() => {
    refreshVersionRef.current += 1;
    setConsultation(initial);
  }, [initial]);

  const refreshConsultation = useCallback(async () => {
    const version = ++refreshVersionRef.current;
    const next = await fetchDetail({ data: { id: consultationId } });
    if (version === refreshVersionRef.current) setConsultation(next);
  }, [consultationId]);

  const progress = useAiRunProgress(aiRunId, refreshConsultation);
  useSerialPolling(refreshConsultation, 5_000);

  const submittingRef = useRef(false);
  const handleMessage = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    if (submittingRef.current) return;
    const body = message.trim();
    if (!body) return;

    submittingRef.current = true;
    setSubmitting(true);
    setError('');

    let result: CreateMessageResponse;
    try {
      result = await addMessage({ data: { consultationId, body } });
    } catch (cause) {
      const err = cause instanceof Error ? cause.message : '送信に失敗しました';
      if (err.includes('authentication required')) {
        setShowAuthModal(true);
      } else {
        setError(err);
      }
      submittingRef.current = false;
      setSubmitting(false);
      return;
    }

    setMessage('');
    try {
      await navigate({
        to: '/consultations/$id',
        params: { id: consultationId },
        search: { run: result.ai_run.id },
        replace: true,
        resetScroll: false,
      });
      await refreshConsultation();
    } catch {
      setError('送信は完了しましたが、画面の更新に失敗しました。再送信せず再読み込みしてください。');
    } finally {
      submittingRef.current = false;
      setSubmitting(false);
    }
  }, [consultationId, message, navigate, refreshConsultation]);

  const statusUpdatingRef = useRef(false);
  const handleStatus = useCallback(async () => {
    if (statusUpdatingRef.current) return;
    statusUpdatingRef.current = true;
    try {
      setError('');
      await updateStatus({
        data: {
          consultationId,
          status: consultation.status === 'resolved' ? 'open' : 'resolved',
        },
      });
      await refreshConsultation();
    } catch (cause) {
      const err = cause instanceof Error ? cause.message : '状態更新に失敗しました';
      if (err.includes('authentication required')) {
        setShowAuthModal(true);
      } else {
        setError(err);
      }
    } finally {
      statusUpdatingRef.current = false;
    }
  }, [consultation.status, consultationId, refreshConsultation]);

  const progressLabel = getProgressLabel(progress);
  const messages = [...consultation.messages].sort((a, b) => a.message_number - b.message_number);

  return (
    <div>
      <Link to="/" style={{ color: '#555041', textDecoration: 'none', fontSize: '0.9rem' }}>← 一覧に戻る</Link>
      <div className="card" style={{ marginTop: '8px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '12px' }}>
          <div style={{ flex: 1 }}>
            <p className="eyebrow">Consultation detail</p>
            <h2 style={{ fontFamily: 'Georgia, serif', fontSize: '1.4rem', marginTop: '4px' }}>{consultation.title}</h2>
            <p style={{ color: '#555041', fontSize: '0.9rem', marginTop: '8px', whiteSpace: 'pre-wrap' }}>{consultation.body}</p>
          </div>
          <button className="status-btn" onClick={handleStatus} style={{ background: consultation.status === 'resolved' ? '#eef5ef' : '#fffaf0' }}>
            {consultation.status === 'resolved' ? '✅ 整理済み' : '🔓 整理中'}
          </button>
        </div>
      </div>

      <div className="section-header"><span>Messages</span><span>{messages.length}件</span></div>

      {messages.map((item) => <MessageCard key={item.id} message={item} />)}

      {error && <div className="card error" style={{ marginTop: '8px' }}>{error}</div>}

      <div className="card" style={{ marginTop: '16px' }}>
        <p className="eyebrow">Continue</p>
        {progressLabel && (
          <div role="status" aria-live="polite" style={{
            marginTop: '8px',
            background: progress.status === 'failed' || progress.status === 'connection_failed' ? '#fff0f0' : '#f0f5ff',
            borderLeft: `3px solid ${progress.status === 'failed' || progress.status === 'connection_failed' ? '#c00' : '#4a90d9'}`,
            padding: '6px 10px', fontSize: '0.8rem', borderRadius: '2px', marginBottom: '8px',
          }}>
            <span style={{ marginRight: '6px' }}>
              {progress.status === 'generating' || progress.status === 'repairing' ? '🤖' : progress.status === 'failed' || progress.status === 'connection_failed' ? '⚠️' : progress.status === 'completed' ? '✅' : '⏳'}
            </span>
            {progressLabel}
          </div>
        )}
        <form onSubmit={handleMessage}>
          <textarea
            value={message}
            onChange={(e) => setMessage(e.target.value)}
            placeholder="AIと一緒にもう少し整理する材料を書く"
            required
          />
          <button type="submit" disabled={submitting}>{submitting ? '送信中...' : '材料を追加する'}</button>
        </form>
      </div>

      {showAuthModal && <AuthModal onClose={() => setShowAuthModal(false)} />}
    </div>
  );
}

function MessageCard({ message }: { message: Message }) {
  return (
    <div className={`message ${message.author_type === 'ai' ? 'message-ai' : ''}`}>
      <div className="message-header">
        <strong>{message.message_number}</strong>
        <span>{authorLabel(message.author_type)}</span>
      </div>
      <div className="message-body">{message.body}</div>
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
        <h3 style={{ fontFamily: 'Georgia, serif', margin: '8px 0 16px' }}>続けるにはログインが必要です</h3>
        {authError && <p style={{ color: '#c53030', fontSize: '0.85rem', marginBottom: '12px' }}>{authError}</p>}
        <button onClick={handleSignIn} disabled={authLoading} style={{ width: '100%' }}>
          {authLoading ? '移動中...' : 'GitHubでログイン'}
        </button>
      </div>
    </div>
  );
}

function authorLabel(authorType: Message['author_type']): string {
  switch (authorType) {
    case 'student': return '受講生';
    case 'tutor': return 'チューター';
    case 'mentor': return 'メンター';
    case 'ai': return 'AI';
  }
}
