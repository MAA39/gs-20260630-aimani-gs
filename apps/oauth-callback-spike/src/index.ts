import { Hono } from 'hono';
import { betterAuth } from 'better-auth';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';

type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  GITHUB_CLIENT_ID: string;
  GITHUB_CLIENT_SECRET: string;
  BETTER_AUTH_URL?: string;
};

type SessionShape = {
  user?: {
    id: string;
    name?: string | null;
    email?: string | null;
    image?: string | null;
  } | null;
  session?: {
    id: string;
    expiresAt?: string | Date;
  } | null;
} | null;

const app = new Hono<{ Bindings: Bindings }>();

function resolveBaseURL(request: Request, env: Bindings): string {
  if (env.BETTER_AUTH_URL?.trim()) return env.BETTER_AUTH_URL.trim().replace(/\/$/, '');
  return new URL(request.url).origin;
}

function createAuth(env: Bindings, request: Request) {
  const baseURL = resolveBaseURL(request, env);
  const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET,
    baseURL,
    trustedOrigins: [baseURL, 'http://localhost:8787'],
    database: {
      db: db as never,
      type: 'sqlite',
    },
    socialProviders: {
      github: {
        clientId: env.GITHUB_CLIENT_ID,
        clientSecret: env.GITHUB_CLIENT_SECRET,
      },
    },
  });
}

async function getSession(request: Request, env: Bindings): Promise<SessionShape> {
  try {
    const auth = createAuth(env, request);
    return await auth.api.getSession({ headers: request.headers }) as SessionShape;
  } catch (error) {
    console.error('getSession failed', {
      name: error instanceof Error ? error.name : 'Unknown',
      message: error instanceof Error ? error.message : String(error),
    });
    return null;
  }
}

function htmlPage(options: { baseURL: string; session: SessionShape; debug?: string }) {
  const user = options.session?.user;
  const session = options.session?.session;
  const sessionJson = JSON.stringify(options.session, null, 2)
    .replace(/</g, '\\u003c');

  return `<!doctype html>
<html lang="ja">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>OAuth Callback Spike</title>
  <style>
    :root { font-family: system-ui, sans-serif; color: #20211d; background: #f7f3e8; }
    body { max-width: 760px; margin: 0 auto; padding: 32px 16px; }
    .card { border: 2px solid #20211d; background: #fffaf0; box-shadow: 5px 5px 0 rgba(32,33,29,.86); padding: 18px; margin: 16px 0; }
    button, a.button { display: inline-block; border: 2px solid #20211d; background: #f0b429; color: #20211d; padding: 10px 14px; font-weight: 800; text-decoration: none; cursor: pointer; }
    pre { overflow: auto; background: #111827; color: #e5e7eb; padding: 12px; border-radius: 6px; }
    .ok { color: #0f766e; font-weight: 800; }
    .ng { color: #b91c1c; font-weight: 800; }
  </style>
</head>
<body>
  <h1>OAuth Callback Spike</h1>
  <p>Cloudflare Worker 単体で Better Auth + GitHub OAuth callback を検証する最小アプリです。</p>

  <div class="card">
    <p><strong>Base URL:</strong> ${options.baseURL}</p>
    <p><strong>Callback URL:</strong> ${options.baseURL}/api/auth/callback/github</p>
    <p><strong>Status:</strong> ${user ? `<span class="ok">signed in as ${user.email ?? user.name ?? user.id}</span>` : '<span class="ng">not signed in</span>'}</p>
    ${session ? `<p><strong>Session:</strong> ${session.id}</p>` : ''}
  </div>

  <div class="card">
    <button id="github">Sign in with GitHub</button>
    <button id="session">Refresh session JSON</button>
    <a class="button" href="/api/auth/sign-out">Sign out endpoint</a>
  </div>

  <div class="card">
    <h2>Session JSON</h2>
    <pre id="output">${sessionJson}</pre>
  </div>

  <script>
    const output = document.getElementById('output');
    const githubButton = document.getElementById('github');
    const sessionButton = document.getElementById('session');

    function findRedirectTarget(data) {
      return data?.url || data?.redirectURL || data?.redirectTo || data?.data?.url || data?.data?.redirectURL || data?.data?.redirectTo;
    }

    githubButton.addEventListener('click', async () => {
      output.textContent = 'Starting GitHub sign-in...';
      const res = await fetch('/api/auth/sign-in/social', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ provider: 'github', callbackURL: '/' }),
      });
      const text = await res.text();
      let data;
      try { data = JSON.parse(text); } catch { data = { raw: text }; }
      output.textContent = JSON.stringify({ status: res.status, headers: Object.fromEntries(res.headers.entries()), data }, null, 2);
      const target = findRedirectTarget(data);
      if (target) window.location.href = target;
    });

    sessionButton.addEventListener('click', async () => {
      const res = await fetch('/debug/session', { credentials: 'include' });
      const data = await res.json();
      output.textContent = JSON.stringify(data, null, 2);
    });
  </script>
</body>
</html>`;
}

app.get('/', async (c) => {
  const baseURL = resolveBaseURL(c.req.raw, c.env);
  const session = await getSession(c.req.raw, c.env);
  return c.html(htmlPage({ baseURL, session }));
});

app.get('/debug/session', async (c) => {
  const baseURL = resolveBaseURL(c.req.raw, c.env);
  const session = await getSession(c.req.raw, c.env);
  return c.json({ ok: true, baseURL, callbackURL: `${baseURL}/api/auth/callback/github`, session });
});

app.get('/debug/headers', (c) => {
  const headers: Record<string, string> = {};
  c.req.raw.headers.forEach((value, key) => {
    headers[key] = value;
  });
  return c.json({ url: c.req.url, headers });
});

app.on(['GET', 'POST'], '/api/auth/**', (c) => {
  const auth = createAuth(c.env, c.req.raw);
  return auth.handler(c.req.raw);
});

export default app;
