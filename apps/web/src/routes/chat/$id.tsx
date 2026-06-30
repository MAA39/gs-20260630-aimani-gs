import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { Consultation, ConsultationDetail, CreateMessageResponse } from '@aimani-gs/contracts';
import { ChatInput } from '../../components/ChatInput';
import { ChatMessage } from '../../components/ChatMessage';
import { FinishModal } from '../../components/FinishModal';
import { Sidebar } from '../../components/Sidebar';
import { useAiRunProgress, getProgressLabel } from '../../lib/use-ai-run-progress';
import { getAuthenticatedApi } from '../../lib/api-fetch';
import { signInWithGitHub } from '../../lib/auth-client';

const fetchChatData = createServerFn({ method: 'GET' })
  .validator((input: { id: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const [detailResponse, chatsResponse] = await Promise.all([
      api(`/api/v1/consultations/${data.id}`),
      api('/api/v1/consultations'),
    ]);
    if (!detailResponse.ok) throw new Error('not found');
    return {
      detail: (await detailResponse.json()) as ConsultationDetail,
      chats: chatsResponse.ok ? (await chatsResponse.json()) as Consultation[] : [],
    };
  });

const addMessage = createServerFn({ method: 'POST' })
  .validator((input: { consultationId: string; body: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const response = await api(`/api/v1/consultations/${data.consultationId}/messages`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ body: data.body }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errorBody.error ?? `message failed: ${response.status}`);
    }
    return (await response.json()) as CreateMessageResponse;
  });

const updateStatus = createServerFn({ method: 'POST' })
  .validator((input: { consultationId: string; status: 'open' | 'resolved' }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const response = await api(`/api/v1/consultations/${data.consultationId}`, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: data.status }),
    });
    if (!response.ok) {
      const errorBody = await response.json().catch(() => ({})) as { error?: string };
      throw new Error(errorBody.error ?? `status update failed: ${response.status}`);
    }
    await response.body?.cancel().catch(() => undefined);
  });

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
type SearchParams = { run?: string };

export const Route = createFileRoute('/chat/$id')({
  validateSearch: (search: Record<string, unknown>): SearchParams => ({
    run: typeof search.run === 'string' && UUID_RE.test(search.run) ? search.run : undefined,
  }),
  loader: async ({ params }) => fetchChatData({ data: { id: params.id } }),
  component: ChatPage,
});

function useSerialPolling(task: () => Promise<void>, intervalMs: number) {
  const taskRef = useRef(task);
  taskRef.current = task;
  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;
    const tick = async () => {
      try {
        if (typeof document === 'undefined' || !document.hidden) await taskRef.current();
      } catch { /* UIを止めない */ }
      finally { if (!stopped) timer = setTimeout(tick, intervalMs); }
    };
    timer = setTimeout(tick, intervalMs);
    return () => { stopped = true; clearTimeout(timer); };
  }, [intervalMs]);
}

function ChatPage() {
  const loaded = Route.useLoaderData();
  const { id } = Route.useParams();
  const { run } = Route.useSearch();
  const navigate = useNavigate();
  const [detail, setDetail] = useState(loaded.detail);
  const [chats, setChats] = useState(loaded.chats);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [finishOpen, setFinishOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const refreshVersionRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    refreshVersionRef.current += 1;
    setDetail(loaded.detail);
    setChats(loaded.chats);
  }, [loaded]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [detail.messages.length]);

  const refreshChat = useCallback(async () => {
    const version = ++refreshVersionRef.current;
    const next = await fetchChatData({ data: { id } });
    if (version === refreshVersionRef.current) {
      setDetail(next.detail);
      setChats(next.chats);
    }
  }, [id]);

  const progress = useAiRunProgress(run ?? null, refreshChat);
  useSerialPolling(refreshChat, 5_000);
  const progressLabel = getProgressLabel(progress);

  const sendMessage = useCallback(async (body: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await addMessage({ data: { consultationId: id, body } });
      await navigate({ to: '/chat/$id', params: { id }, search: { run: result.ai_run.id }, replace: true, resetScroll: false });
      await refreshChat();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '送信に失敗しました';
      if (message.includes('authentication required')) setShowAuthModal(true);
      else if (message.includes('turn limit reached')) setError('このチャットは上限に達しました。「整理する」から内容をまとめてください。');
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [id, navigate, refreshChat, submitting]);

  const handleOptionSelect = useCallback((question: string, option: string) => {
    void sendMessage(`[${question}] ${option}`);
  }, [sendMessage]);

  const handleFinish = useCallback(async (mode: 'private' | 'tutor' | 'mentor') => {
    setFinishOpen(false);
    try {
      await updateStatus({ data: { consultationId: id, status: 'resolved' } });
    } catch { /* report画面には進める */ }
    await navigate({ to: '/chat/$id/report', params: { id }, search: { mode } });
  }, [id, navigate]);

  const messages = [...detail.messages].sort((a, b) => a.message_number - b.message_number);
  const humanTurns = messages.filter((message) => message.author_type !== 'ai').length;

  return (
    <div className="chat-shell">
      <Sidebar chats={chats} activeId={id} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <section className="chat-main">
        <header className="chat-header">
          <button type="button" className="icon-button" onClick={() => setSidebarOpen(true)}>☰</button>
          <div className="chat-title-block">
            <strong>{detail.title}</strong>
            <small>{humanTurns}/20 ターン</small>
          </div>
          <button type="button" className="status-btn" onClick={() => setFinishOpen(true)}>整理する</button>
        </header>

        <div className="chat-scroll" ref={scrollRef}>
          {messages.map((message) => (
            <ChatMessage
              key={message.id}
              message={message}
              onOptionSelect={handleOptionSelect}
              disabled={submitting || progress.status === 'generating' || progress.status === 'repairing'}
            />
          ))}
          {humanTurns >= 10 && (
            <div className="soft-limit-note">
              ここまででかなり材料が出ています。続けても大丈夫ですが、「整理する」からまとめに進めます。
            </div>
          )}
        </div>

        <div className="chat-input-dock">
          {progressLabel && <div className="progress-label">{progressLabel}</div>}
          {error && <div className="card error">{error}</div>}
          <ChatInput onSubmit={sendMessage} disabled={submitting || humanTurns >= 20} />
        </div>
      </section>
      {finishOpen && <FinishModal onClose={() => setFinishOpen(false)} onSelect={handleFinish} />}
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
      <div className="card modal-card" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">Sign in</p>
        <h3 style={{ fontFamily: 'Georgia, serif', margin: '8px 0 16px' }}>GitHubでログインしてください</h3>
        {authError && <p style={{ color: '#c53030', fontSize: '0.85rem', marginBottom: '12px' }}>{authError}</p>}
        <button onClick={handleSignIn} disabled={authLoading} style={{ width: '100%' }}>
          {authLoading ? '移動中...' : 'GitHubでログイン'}
        </button>
      </div>
    </div>
  );
}
