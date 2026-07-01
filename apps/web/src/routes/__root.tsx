import { HeadContent, Outlet, Scripts, createRootRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';
import { authClient } from '../lib/auth-client';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'aimani-gs' },
    ],
  }),
  shellComponent: RootShell,
  component: RootComponent,
});

function AuthStatus() {
  const { data: session, isPending } = authClient.useSession();
  if (isPending) return <span className="auth-status">...</span>;
  if (!session?.user) return <span className="auth-status auth-status-out">未ログイン</span>;
  return (
    <span className="auth-status auth-status-in">
      <span>{session.user.name || session.user.email || 'ログイン中'}</span>
      <button type="button" className="auth-logout-btn" onClick={() => authClient.signOut().then(() => window.location.reload())}>ログアウト</button>
    </span>
  );
}

function RootComponent() {
  return (
    <>
      <div className="auth-bar"><AuthStatus /></div>
      <Outlet />
    </>
  );
}

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <header className="app-header">
          <div className="container header-inner">
            <div>
              <p className="eyebrow">G&apos;s Academy Prototype</p>
              <h1>
                <Link to="/chat/new" style={{ color: '#20211d', textDecoration: 'none' }}>
                  aimani-gs
                </Link>
              </h1>
              <p className="lead">課題・チーム開発・進路のモヤモヤを、相談しやすい形に整える。</p>
            </div>
            <a
              href="https://github.com/MAA39/gs-20260630-aimani-gs"
              target="_blank"
              rel="noopener noreferrer"
              className="github-link"
            >
              GitHub ↗
            </a>
          </div>
        </header>
        <main className="container app-main">{children}</main>
        <Scripts />
      </body>
    </html>
  );
}

const STYLES = `
:root { font-family: 'Hiragino Sans', 'Yu Gothic', Meiryo, sans-serif; font-size: 16px; line-height: 1.5; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: linear-gradient(90deg, rgba(32,33,29,0.06) 1px, transparent 1px), linear-gradient(rgba(32,33,29,0.05) 1px, transparent 1px), #f7f3e8; background-size: 28px 28px; color: #20211d; }
.container { max-width: 1120px; margin: 0 auto; padding: 16px; }
.app-header { border-bottom: 2px solid #20211d; background: #fffaf0; padding: 12px 0; }
.app-main { min-height: calc(100vh - 110px); }
.header-inner { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
header h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 28px; font-weight: 800; line-height: 1; }
.lead { color: #555041; font-size: 13px; margin-top: 6px; }
.eyebrow { color: #2f7d68; font-size: 12px; font-weight: 800; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.04em; }
.github-link { border: 2px solid #20211d; background: #fffaf0; padding: 6px 12px; font-size: 13px; font-weight: 900; color: #20211d; text-decoration: none; white-space: nowrap; }
.card { border: 2px solid #20211d; background: #fffaf0; padding: 16px; margin-bottom: 12px; box-shadow: 5px 5px 0 rgba(32,33,29,0.86); }
input, textarea, select { width: 100%; border: 2px solid #20211d; border-radius: 0; background: #fff; color: #20211d; font: inherit; padding: 10px 12px; margin-bottom: 8px; }
textarea { resize: vertical; min-height: 96px; }
button { border: 2px solid #20211d; border-radius: 0; background: #f0b429; color: #20211d; cursor: pointer; font: inherit; font-weight: 900; padding: 10px 16px; transition: transform 140ms ease, box-shadow 140ms ease; }
button:hover:not(:disabled) { transform: translate(-2px, -2px); box-shadow: 4px 4px 0 #20211d; }
button:disabled { cursor: not-allowed; opacity: 0.55; }
.error { background: #fff0f0; color: #c53030; border-color: #feb2b2; }
.icon-button { width: 42px; height: 42px; display: inline-grid; place-items: center; padding: 0; background: #fffaf0; }
.status-btn { font-size: 0.85rem; padding: 8px 12px; white-space: nowrap; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 100; }
.modal-card { max-width: 420px; margin: 16px; box-shadow: 8px 8px 0 rgba(32,33,29,0.86); }
.finish-actions { display: grid; gap: 10px; }
.chat-shell { position: relative; display: grid; grid-template-columns: 260px 1fr; gap: 16px; min-height: calc(100vh - 145px); }
.sidebar { border: 2px solid #20211d; background: #fffaf0; box-shadow: 5px 5px 0 rgba(32,33,29,0.86); padding: 14px; height: calc(100vh - 150px); overflow-y: auto; }
.sidebar-header { display: flex; justify-content: space-between; align-items: center; margin-bottom: 12px; }
.new-chat-link { display: block; border: 2px solid #20211d; background: #f0b429; color: #20211d; text-decoration: none; font-weight: 900; padding: 10px 12px; margin-bottom: 14px; text-align: center; }
.chat-list { display: grid; gap: 8px; }
.chat-list-item { display: grid; gap: 4px; border: 1px solid #c4b89a; background: #fff; color: #20211d; text-decoration: none; padding: 10px; }
.chat-list-item.active { border: 2px solid #20211d; background: #eef5ef; }
.chat-list-item span { font-weight: 800; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-list-item small, .empty-sidebar { color: #555041; font-size: 12px; }
.chat-main { border: 2px solid #20211d; background: rgba(255,250,240,0.88); box-shadow: 5px 5px 0 rgba(32,33,29,0.86); min-height: calc(100vh - 150px); display: grid; grid-template-rows: auto 1fr auto; overflow: hidden; }
.chat-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; padding: 12px; border-bottom: 2px solid #20211d; background: #fffaf0; }
.chat-title-block { display: grid; gap: 2px; min-width: 0; flex: 1; }
.chat-title-block strong { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
.chat-title-block small { color: #555041; font-size: 12px; }
.chat-scroll { overflow-y: auto; padding: 18px; display: grid; gap: 16px; align-content: start; }
.chat-message { display: grid; grid-template-columns: 38px minmax(0, 1fr); gap: 10px; align-items: start; }
.avatar { width: 38px; height: 38px; border: 2px solid #20211d; background: #fffaf0; display: grid; place-items: center; font-weight: 900; font-size: 12px; }
.chat-bubble { border: 2px solid #20211d; background: #fffaf0; padding: 14px; box-shadow: 3px 3px 0 rgba(32,33,29,0.72); }
.ai-bubble { background: #eef5ef; }
.human-bubble { background: #fff; }
.quote-span { color: #2f7d68; font-style: italic; border-left: 4px solid #2f7d68; padding-left: 10px; margin-bottom: 10px; white-space: pre-wrap; }
.message-body { line-height: 1.8; white-space: pre-wrap; }
.question-groups { display: grid; gap: 12px; margin-top: 14px; }
.question-group { display: grid; gap: 8px; }
.question-text { font-weight: 900; }
.choice-pills { display: flex; flex-wrap: wrap; gap: 8px; }
.choice-pill { background: #fff; border-radius: 999px; padding: 8px 12px; font-size: 0.9rem; }
.chat-input-dock { border-top: 2px solid #20211d; background: #fffaf0; padding: 12px; }
.chat-input { display: grid; grid-template-columns: 1fr auto; gap: 8px; align-items: end; }
.chat-input textarea { margin-bottom: 0; min-height: 56px; }
.progress-label { color: #555041; font-size: 13px; margin-bottom: 8px; }
.soft-limit-note { border: 2px dashed #2f7d68; background: #f7fff8; padding: 12px; color: #2f7d68; font-weight: 800; }
.new-chat-main { place-items: stretch; }
.new-chat-panel { max-width: 720px; width: 100%; margin: 40px auto; padding: 24px; }
.new-chat-panel h2 { font-family: Georgia, 'Times New Roman', serif; font-size: 2rem; margin-bottom: 18px; }
.category-grid { display: grid; grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 10px; }
.report-page { max-width: 860px; margin: 0 auto; }
.report-header { margin-bottom: 16px; }
.report-header h2 { font-family: Georgia, 'Times New Roman', serif; margin: 8px 0; }
.report-header p { color: #555041; }
.report-editor textarea { min-height: 420px; font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace; line-height: 1.7; }
.report-actions { display: flex; flex-wrap: wrap; gap: 10px; justify-content: flex-end; }
.shared-report-card { border: 2px solid #20211d; background: #fffaf0; padding: 18px; box-shadow: 5px 5px 0 rgba(32,33,29,0.86); margin-bottom: 16px; }
.shared-report-card pre { white-space: pre-wrap; font: inherit; line-height: 1.8; }
@media (max-width: 860px) {
  .container { padding: 10px; }
  .github-link { display: none; }
  .chat-shell { display: block; min-height: calc(100vh - 120px); }
  .sidebar { position: fixed; inset: 0 auto 0 0; width: 86vw; max-width: 320px; z-index: 80; transform: translateX(-110%); transition: transform 160ms ease; height: 100vh; }
  .sidebar.sidebar-open { transform: translateX(0); }
  .chat-main { min-height: calc(100vh - 125px); }
  .category-grid { grid-template-columns: 1fr; }
  .chat-input { grid-template-columns: 1fr; }
}
.auth-bar { display: flex; justify-content: flex-end; padding: 6px 16px; background: #20211d; color: #fffaf0; font-size: 13px; }
.auth-status { display: flex; align-items: center; gap: 10px; }
.auth-status-out { color: #c4b89a; }
.auth-status-in { display: flex; align-items: center; gap: 10px; }
.auth-logout-btn { background: none; border: 1px solid #c4b89a; color: #fffaf0; padding: 2px 10px; font-size: 12px; cursor: pointer; border-radius: 3px; }
`;
