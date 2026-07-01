import { StrictMode, useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { createRoot } from 'react-dom/client';
import {
  Link,
  Outlet,
  RouterProvider,
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
  useNavigate,
} from '@tanstack/react-router';
import type { Consultation } from '@aimani-gs/contracts';
import { createConsultation, fetchConsultations } from './api';
import { getSession, signInWithGitHub, signOut } from './auth';
import type { SessionPayload } from './auth';
import './styles.css';

const categories = [
  '課題で詰まっている',
  'チーム開発の困りごと',
  '進路・キャリア',
  'メンター面談の準備',
] as const;

type ChatInputProps = {
  onSubmit: (body: string) => Promise<void> | void;
  disabled?: boolean;
  submitLabel?: string;
};

function ChatInput({ onSubmit, disabled = false, submitLabel = '送信' }: ChatInputProps) {
  const [value, setValue] = useState('');

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const body = value.trim();
    if (!body || disabled) return;
    await onSubmit(body);
    setValue('');
  };

  return (
    <form className="chat-input" onSubmit={handleSubmit}>
      <textarea
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="困っていることを書いてください..."
        disabled={disabled}
        rows={2}
      />
      <button type="submit" disabled={disabled || !value.trim()}>{submitLabel}</button>
    </form>
  );
}

function RootLayout() {
  const [session, setSession] = useState<SessionPayload | null>(null);
  const [sessionStatus, setSessionStatus] = useState<'loading' | 'ready'>('loading');

  const refreshSession = useCallback(async () => {
    setSessionStatus('loading');
    try {
      setSession(await getSession());
    } finally {
      setSessionStatus('ready');
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.hydrated = 'true';
    void refreshSession();
  }, [refreshSession]);

  const handleSignOut = useCallback(async () => {
    await signOut();
    await refreshSession();
  }, [refreshSession]);

  return (
    <div className="app-shell">
      <header className="top-bar">
        <Link to="/chat/new" className="brand">Aimani GS SPA</Link>
        <div className="session-box">
          {sessionStatus === 'loading' ? (
            <span>session確認中...</span>
          ) : session?.user ? (
            <>
              <span>{session.user.name ?? session.user.email ?? 'ログイン中'}</span>
              <button type="button" className="ghost-button" onClick={handleSignOut}>ログアウト</button>
            </>
          ) : (
            <button type="button" className="ghost-button" onClick={() => void signInWithGitHub('/chat/new')}>
              GitHubログイン
            </button>
          )}
        </div>
      </header>
      <Outlet />
    </div>
  );
}

function NewChatPage() {
  const navigate = useNavigate();
  const [chats, setChats] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    let cancelled = false;
    void fetchConsultations()
      .then((items) => {
        if (!cancelled) setChats(items);
      })
      .catch((cause) => {
        if (!cancelled) setError(cause instanceof Error ? cause.message : '相談一覧を取得できませんでした');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const startChat = useCallback(async (body: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await createConsultation(body);
      await navigate({ to: '/chat/$id', params: { id: result.id }, search: { run: result.ai_run.id } });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'チャットを開始できませんでした';
      if (message.includes('authentication required') || message.includes('401')) {
        setShowAuthModal(true);
      } else {
        setError(message);
      }
    } finally {
      setSubmitting(false);
    }
  }, [navigate, submitting]);

  return (
    <main className="chat-shell">
      <aside className="sidebar">
        <strong>相談履歴</strong>
        {loading ? <p>読み込み中...</p> : null}
        {!loading && chats.length === 0 ? <p>まだ相談はありません</p> : null}
        <nav>
          {chats.map((chat) => (
            <Link key={chat.id} to="/chat/$id" params={{ id: chat.id }} className="chat-link">
              {chat.title ?? chat.body.slice(0, 32)}
            </Link>
          ))}
        </nav>
      </aside>
      <section className="chat-main new-chat-main">
        <div className="new-chat-panel">
          <p className="eyebrow">SPA Probe</p>
          <h1>何に困っていますか？</h1>
          <p className="lead">TanStack Startを通さず、TanStack Router + Vite SPAでOAuthとAPI疎通だけを検証します。</p>
          <div className="category-grid">
            {categories.map((category) => (
              <button key={category} type="button" onClick={() => void startChat(category)} disabled={submitting}>
                {category}
              </button>
            ))}
          </div>
          {error ? <div className="card error">{error}</div> : null}
        </div>
        <div className="chat-input-dock">
          <ChatInput onSubmit={startChat} disabled={submitting} submitLabel="始める" />
        </div>
      </section>
      {showAuthModal ? <AuthModal onClose={() => setShowAuthModal(false)} /> : null}
    </main>
  );
}

function AuthModal({ onClose }: { onClose: () => void }) {
  const [authError, setAuthError] = useState('');
  const [authLoading, setAuthLoading] = useState(false);

  const handleSignIn = useCallback(async () => {
    setAuthError('');
    setAuthLoading(true);
    try {
      await signInWithGitHub('/chat/new');
    } catch (cause) {
      setAuthError(cause instanceof Error ? cause.message : 'GitHubログインに失敗しました');
      setAuthLoading(false);
    }
  }, []);

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal-card" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">Sign in</p>
        <h2>GitHubでログインしてください</h2>
        {authError ? <p className="error-text">{authError}</p> : null}
        <button onClick={handleSignIn} disabled={authLoading}>
          {authLoading ? '移動中...' : 'GitHubでログイン'}
        </button>
      </div>
    </div>
  );
}

function ChatPlaceholder() {
  return (
    <main className="placeholder-page">
      <h1>チャット画面は次の移植対象です</h1>
      <p>まずはログイン、セッション確認、相談作成POSTまでをSPAで安定させます。</p>
      <Link to="/chat/new">新規チャットへ戻る</Link>
    </main>
  );
}

const rootRoute = createRootRoute({ component: RootLayout });

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/chat/new' });
  },
});

const chatNewRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/new',
  component: NewChatPage,
});

const chatIdRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/chat/$id',
  component: ChatPlaceholder,
});

const routeTree = rootRoute.addChildren([indexRoute, chatNewRoute, chatIdRoute]);
const router = createRouter({ routeTree });

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router;
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RouterProvider router={router} />
  </StrictMode>,
);
