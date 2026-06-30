import { HeadContent, Outlet, Scripts, createRootRoute, Link } from '@tanstack/react-router';
import type { ReactNode } from 'react';

export const Route = createRootRoute({
  head: () => ({
    meta: [
      { charSet: 'utf-8' },
      { name: 'viewport', content: 'width=device-width, initial-scale=1' },
      { title: 'aimani-gs' },
    ],
  }),
  shellComponent: RootShell,
  component: () => <Outlet />,
});

function RootShell({ children }: { children: ReactNode }) {
  return (
    <html lang="ja">
      <head>
        <HeadContent />
        <style dangerouslySetInnerHTML={{ __html: STYLES }} />
      </head>
      <body>
        <header>
          <div className="container header-inner">
            <div>
              <p className="eyebrow">G&apos;s Academy Prototype</p>
              <h1>
                <Link to="/" style={{ color: '#20211d', textDecoration: 'none' }}>
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
        <main className="container">{children}</main>
        <Scripts />
      </body>
    </html>
  );
}

const STYLES = `
:root { font-family: 'Hiragino Sans', 'Yu Gothic', Meiryo, sans-serif; font-size: 16px; line-height: 1.5; }
* { margin: 0; padding: 0; box-sizing: border-box; }
body { background: linear-gradient(90deg, rgba(32,33,29,0.06) 1px, transparent 1px), linear-gradient(rgba(32,33,29,0.05) 1px, transparent 1px), #f7f3e8; background-size: 28px 28px; color: #20211d; }
.container { max-width: 760px; margin: 0 auto; padding: 16px; }
header { border-bottom: 2px solid #20211d; background: #fffaf0; padding: 16px 0; }
.header-inner { display: flex; justify-content: space-between; align-items: center; gap: 16px; }
header h1 { font-family: Georgia, 'Times New Roman', serif; font-size: 30px; font-weight: 800; line-height: 1; }
.lead { color: #555041; font-size: 13px; margin-top: 6px; }
.eyebrow { color: #2f7d68; font-size: 12px; font-weight: 800; text-transform: uppercase; margin-bottom: 4px; letter-spacing: 0.04em; }
.github-link { border: 2px solid #20211d; background: #fffaf0; padding: 6px 12px; font-size: 13px; font-weight: 900; color: #20211d; text-decoration: none; white-space: nowrap; }
.card { border: 2px solid #20211d; background: #fffaf0; padding: 16px; margin-bottom: 12px; box-shadow: 5px 5px 0 rgba(32,33,29,0.86); }
input, textarea, select { width: 100%; border: 2px solid #20211d; border-radius: 0; background: #fff; color: #20211d; font: inherit; padding: 10px 12px; margin-bottom: 8px; }
textarea { resize: vertical; min-height: 96px; }
button { border: 2px solid #20211d; border-radius: 0; background: #f0b429; color: #20211d; cursor: pointer; font: inherit; font-weight: 900; padding: 10px 16px; transition: transform 140ms ease, box-shadow 140ms ease; }
button:hover:not(:disabled) { transform: translate(-2px, -2px); box-shadow: 4px 4px 0 #20211d; }
button:disabled { cursor: not-allowed; opacity: 0.55; }
.consultation-card { border: 2px solid #20211d; background: #fffaf0; padding: 14px; margin-bottom: 10px; box-shadow: 4px 4px 0 rgba(32,33,29,0.86); }
.consultation-card:hover { transform: translate(-1px, -1px); box-shadow: 5px 5px 0 rgba(32,33,29,0.86); }
.consultation-card a { text-decoration: none; color: inherit; }
.consultation-title { font-weight: 900; font-size: 1.05rem; }
.consultation-preview { color: #555041; font-size: 14px; margin-top: 4px; white-space: pre-wrap; }
.message { border: 2px solid #20211d; background: #fffaf0; padding: 14px; margin-bottom: 10px; box-shadow: 4px 4px 0 rgba(32,33,29,0.86); }
.message-ai { background: #eef5ef; }
.message-header { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; font-size: 13px; color: #555041; }
.message-header strong { display: inline-grid; place-items: center; min-width: 28px; height: 28px; background: #20211d; color: #fffaf0; font-size: 13px; }
.message-body { margin-top: 10px; line-height: 1.8; white-space: pre-wrap; }
.section-header { display: flex; align-items: center; justify-content: space-between; border: 2px solid #20211d; background: #2f7d68; color: #fffaf0; padding: 10px 14px; font-weight: 900; font-size: 14px; margin-bottom: 10px; }
.badge { border: 1px solid #20211d; background: #fff; font-size: 11px; font-weight: 900; padding: 2px 7px; display: inline-block; }
.status-btn { font-size: 0.8rem; padding: 4px 10px; white-space: nowrap; }
.error { background: #fff0f0; color: #c53030; border-color: #feb2b2; }
.modal-backdrop { position: fixed; inset: 0; background: rgba(0,0,0,0.5); display: grid; place-items: center; z-index: 100; }
.modal-card { max-width: 380px; margin: 16px; box-shadow: 8px 8px 0 rgba(32,33,29,0.86); }
`;
