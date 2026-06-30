import { createFileRoute, useNavigate } from '@tanstack/react-router';
import { createServerFn } from '@tanstack/react-start';
import { useCallback, useState } from 'react';
import type { Consultation, CreateConsultationResponse } from '@aimani-gs/contracts';
import { ChatInput } from '../../components/ChatInput';
import { Sidebar } from '../../components/Sidebar';
import { getAuthenticatedApi } from '../../lib/api-fetch';
import { signInWithGitHub } from '../../lib/auth-client';

const categories = [
  '課題で詰まっている',
  'チーム開発の困りごと',
  '進路・キャリア',
  'メンター面談の準備',
] as const;

const fetchChats = createServerFn({ method: 'GET' })
  .handler(async () => {
    const api = await getAuthenticatedApi();
    const res = await api('/api/v1/consultations');
    return res.ok ? (await res.json()) as Consultation[] : [];
  });

const createChat = createServerFn({ method: 'POST' })
  .validator((input: { body: string }) => input)
  .handler(async ({ data }) => {
    const api = await getAuthenticatedApi();
    const res = await api('/api/v1/consultations', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ title: data.body, body: data.body, visibility: 'private' }),
    });
    if (!res.ok) {
      const errorBody = await res.json().catch(() => ({})) as { error?: string };
      throw new Error(errorBody.error ?? `chat create failed: ${res.status}`);
    }
    return (await res.json()) as CreateConsultationResponse;
  });

export const Route = createFileRoute('/chat/new')({
  loader: () => fetchChats(),
  component: NewChatPage,
});

function NewChatPage() {
  const chats = Route.useLoaderData();
  const navigate = useNavigate();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [error, setError] = useState('');

  const startChat = useCallback(async (body: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await createChat({ data: { body } });
      await navigate({ to: '/chat/$id', params: { id: result.id }, search: { run: result.ai_run.id } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'チャットを開始できませんでした';
      if (message.includes('authentication required')) {
        setShowAuthModal(true);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [navigate, submitting]);

  return (
    <div className="chat-shell">
      <Sidebar chats={chats} open={sidebarOpen} onClose={() => setSidebarOpen(false)} />
      <section className="chat-main new-chat-main">
        <div className="chat-header">
          <button type="button" className="icon-button" onClick={() => setSidebarOpen(true)}>☰</button>
          <strong>新規チャット</strong>
        </div>
        <div className="new-chat-panel">
          <p className="eyebrow">Start</p>
          <h2>何に困っていますか？</h2>
          <div className="category-grid">
            {categories.map((category) => (
              <button key={category} type="button" onClick={() => startChat(category)} disabled={submitting}>
                {category}
              </button>
            ))}
          </div>
          {error && <div className="card error">{error}</div>}
        </div>
        <div className="chat-input-dock">
          <ChatInput onSubmit={startChat} disabled={submitting} submitLabel="始める" />
        </div>
      </section>
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
