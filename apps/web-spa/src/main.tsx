import { StrictMode, useCallback, useEffect, useRef, useState } from 'react';
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
import type {
  Consultation,
  ConsultationDetail,
  Message,
  QuestionWithOptions,
  ReportShareTarget,
  SessionTurnOutput,
} from '@aimani-gs/contracts';
import {
  createConsultation,
  createMessage,
  fetchConsultationDetail,
  fetchConsultations,
  updateConsultationStatus,
} from './api';
import { getSession, signInWithGitHub, signOut } from './auth';
import type { SessionPayload } from './auth';
import { getProgressLabel, useAiRunProgress } from './ai-run-progress';
import './styles.css';

const categories = [
  '課題で詰まっている',
  'チーム開発の困りごと',
  '進路・キャリア',
  'メンター面談の準備',
] as const;

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type ChatSearch = { run?: string };
type FinishMode = 'private' | ReportShareTarget;

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

function SidebarList({ chats, activeId }: { chats: Consultation[]; activeId?: string }) {
  return (
    <aside className="sidebar">
      <strong>相談履歴</strong>
      {chats.length === 0 ? <p>まだ相談はありません</p> : null}
      <nav>
        {chats.map((chat) => (
          <Link
            key={chat.id}
            to="/chat/$id"
            params={{ id: chat.id }}
            className={chat.id === activeId ? 'chat-link active' : 'chat-link'}
          >
            {chat.title ?? chat.body.slice(0, 32)}
          </Link>
        ))}
      </nav>
    </aside>
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
      <SidebarList chats={chats} />
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
          {loading ? <p className="muted">相談履歴を読み込み中...</p> : null}
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

function ChatPage() {
  const { id } = chatIdRoute.useParams();
  const { run } = chatIdRoute.useSearch();
  const navigate = useNavigate();
  const [detail, setDetail] = useState<ConsultationDetail | null>(null);
  const [chats, setChats] = useState<Consultation[]>([]);
  const [loading, setLoading] = useState(true);
  const [finishOpen, setFinishOpen] = useState(false);
  const [showAuthModal, setShowAuthModal] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [runId, setRunId] = useState<string | null>(run ?? null);
  const refreshVersionRef = useRef(0);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    setRunId(run ?? null);
  }, [run]);

  const refreshChat = useCallback(async () => {
    const version = ++refreshVersionRef.current;
    const [nextDetail, nextChats] = await Promise.all([
      fetchConsultationDetail(id),
      fetchConsultations(),
    ]);
    if (version !== refreshVersionRef.current) return;
    setDetail(nextDetail);
    setChats(nextChats);
  }, [id]);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError('');
    void Promise.all([fetchConsultationDetail(id), fetchConsultations()])
      .then(([nextDetail, nextChats]) => {
        if (cancelled) return;
        refreshVersionRef.current += 1;
        setDetail(nextDetail);
        setChats(nextChats);
      })
      .catch((cause) => {
        if (cancelled) return;
        const message = cause instanceof Error ? cause.message : 'チャットを読み込めませんでした';
        if (message.includes('authentication required') || message.includes('401')) setShowAuthModal(true);
        else setError(message);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [id]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [detail?.messages.length]);

  useSerialPolling(refreshChat, 5_000);
  const progress = useAiRunProgress(runId, refreshChat);
  const progressLabel = getProgressLabel(progress);

  const sendMessage = useCallback(async (body: string) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try {
      const result = await createMessage(id, body);
      setRunId(result.ai_run.id);
      await navigate({ to: '/chat/$id', params: { id }, search: { run: result.ai_run.id }, replace: true });
      await refreshChat();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '送信に失敗しました';
      if (message.includes('authentication required') || message.includes('401')) setShowAuthModal(true);
      else if (message.includes('turn limit reached')) setError('このチャットは上限に達しました。「整理する」から内容をまとめてください。');
      else setError(message);
    } finally {
      setSubmitting(false);
    }
  }, [id, navigate, refreshChat, submitting]);

  const handleOptionSelect = useCallback((question: string, option: string) => {
    void sendMessage(`[${question}] ${option}`);
  }, [sendMessage]);

  const handleFinish = useCallback(async (mode: FinishMode) => {
    setFinishOpen(false);
    try {
      await updateConsultationStatus(id, 'resolved');
      setError(mode === 'private'
        ? 'この相談を解決済みにしました。レポート画面は次の移植対象です。'
        : `${mode === 'tutor' ? 'チューター' : 'メンター'}共有用レポート画面は次の移植対象です。`);
      await refreshChat();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : '整理に失敗しました');
    }
  }, [id, refreshChat]);

  if (loading && !detail) {
    return (
      <main className="chat-shell">
        <SidebarList chats={chats} activeId={id} />
        <section className="chat-main center-state">
          <p>チャットを読み込み中...</p>
        </section>
      </main>
    );
  }

  if (!detail) {
    return (
      <main className="chat-shell">
        <SidebarList chats={chats} activeId={id} />
        <section className="chat-main center-state">
          <div className="card error">{error || 'チャットを読み込めませんでした'}</div>
          <Link to="/chat/new">新規チャットへ戻る</Link>
        </section>
        {showAuthModal ? <AuthModal onClose={() => setShowAuthModal(false)} /> : null}
      </main>
    );
  }

  const messages = [...detail.messages].sort((a, b) => a.message_number - b.message_number);
  const humanTurns = messages.filter((message) => message.author_type !== 'ai').length;
  const aiBusy = progress.status === 'generating' || progress.status === 'repairing';

  return (
    <main className="chat-shell">
      <SidebarList chats={chats} activeId={id} />
      <section className="chat-main conversation-main">
        <header className="chat-header">
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
              disabled={submitting || aiBusy}
            />
          ))}
          {humanTurns >= 10 ? (
            <div className="soft-limit-note">
              ここまででかなり材料が出ています。続けても大丈夫ですが、「整理する」からまとめに進めます。
            </div>
          ) : null}
        </div>

        <div className="chat-input-dock">
          {progressLabel ? <div className="progress-label">{progressLabel}</div> : null}
          {error ? <div className={error.includes('移植対象') || error.includes('解決済み') ? 'card notice' : 'card error'}>{error}</div> : null}
          <ChatInput onSubmit={sendMessage} disabled={submitting || humanTurns >= 20} />
        </div>
      </section>
      {finishOpen ? <FinishModal onClose={() => setFinishOpen(false)} onSelect={handleFinish} /> : null}
      {showAuthModal ? <AuthModal onClose={() => setShowAuthModal(false)} /> : null}
    </main>
  );
}

function ChatMessage({ message, onOptionSelect, disabled = false }: {
  message: Message;
  onOptionSelect: (question: string, option: string) => void;
  disabled?: boolean;
}) {
  if (message.author_type === 'ai') {
    const parsed = parseTurnOutput(message.body);
    if (!parsed) {
      return (
        <article className="chat-message ai-message">
          <Avatar label="AI" />
          <div className="chat-bubble ai-bubble">
            <p className="message-body">{message.body}</p>
          </div>
        </article>
      );
    }

    return (
      <article className="chat-message ai-message">
        <Avatar label="AI" />
        <div className="chat-bubble ai-bubble">
          <blockquote className="quote-span">「{parsed.quote_span}」</blockquote>
          <p className="message-body">{parsed.response_text}</p>
          <QuestionChoices questions={parsed.questions} onSelect={onOptionSelect} disabled={disabled} />
        </div>
      </article>
    );
  }

  return (
    <article className="chat-message human-message">
      <Avatar label={authorInitial(message.author_type)} />
      <div className="chat-bubble human-bubble">
        <p className="message-body">{message.body}</p>
      </div>
    </article>
  );
}

function QuestionChoices({ questions, onSelect, disabled = false }: {
  questions: QuestionWithOptions[];
  onSelect: (question: string, option: string) => void;
  disabled?: boolean;
}) {
  return (
    <div className="question-groups">
      {questions.map((question) => (
        <div key={question.question} className="question-group">
          <p className="question-text">{question.question}</p>
          <div className="choice-pills">
            {question.options.map((option) => (
              <button
                key={`${question.question}-${option}`}
                type="button"
                className="choice-pill"
                disabled={disabled}
                onClick={() => onSelect(question.question, option)}
              >
                {option}
              </button>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

function FinishModal({ onClose, onSelect }: {
  onClose: () => void;
  onSelect: (mode: FinishMode) => void;
}) {
  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="card modal-card" onClick={(event) => event.stopPropagation()}>
        <p className="eyebrow">整理する</p>
        <h2>ここまでをどう扱いますか？</h2>
        <div className="finish-actions">
          <button type="button" onClick={() => onSelect('private')}>自分だけで保持する</button>
          <button type="button" onClick={() => onSelect('tutor')}>チューターに相談する</button>
          <button type="button" onClick={() => onSelect('mentor')}>メンターに相談する</button>
        </div>
      </div>
    </div>
  );
}

function Avatar({ label }: { label: string }) {
  return <div className="avatar">{label}</div>;
}

function parseTurnOutput(body: string): SessionTurnOutput | null {
  try {
    const parsed = JSON.parse(body) as Partial<SessionTurnOutput>;
    if (
      typeof parsed.quote_span === 'string' &&
      typeof parsed.response_text === 'string' &&
      Array.isArray(parsed.questions)
    ) {
      return parsed as SessionTurnOutput;
    }
    return null;
  } catch {
    return null;
  }
}

function authorInitial(authorType: Message['author_type']): string {
  switch (authorType) {
    case 'student': return 'S';
    case 'tutor': return 'T';
    case 'mentor': return 'M';
    case 'ai': return 'AI';
  }
}

function useSerialPolling(task: () => Promise<void>, intervalMs: number) {
  const taskRef = useRef(task);
  taskRef.current = task;

  useEffect(() => {
    let stopped = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = async () => {
      try {
        if (!document.hidden) await taskRef.current();
      } catch {
        // UIを止めない
      } finally {
        if (!stopped) timer = setTimeout(tick, intervalMs);
      }
    };

    timer = setTimeout(tick, intervalMs);
    return () => {
      stopped = true;
      clearTimeout(timer);
    };
  }, [intervalMs]);
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
  validateSearch: (search: Record<string, unknown>): ChatSearch => ({
    run: typeof search.run === 'string' && UUID_RE.test(search.run) ? search.run : undefined,
  }),
  component: ChatPage,
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
