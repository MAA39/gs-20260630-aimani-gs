import { Hono } from 'hono';
import type { Context } from 'hono';
import { cors } from 'hono/cors';
import { consultationRoutes } from './routes/consultations.ts';
import { internalCallbackRoutes } from './routes/internal-callbacks.ts';
import { aiRunEventRoutes } from './routes/ai-run-events.ts';
import { createAuth, resolveAuthBaseURL } from './auth.ts';
import { jsonBodyLimit, BODY_LIMITS } from './middleware/body-limit.ts';

type Bindings = {
  DB: D1Database;
  BETTER_AUTH_SECRET: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
  INTERNAL_CALLBACK_KEY: string;
  AGENT: { fetch: typeof fetch };
};

const corsMiddleware = cors({
  origin: ['https://aimani-gs-web.masa-nekoshinshi39.workers.dev', 'http://localhost:5173'],
  credentials: true,
  allowHeaders: ['Content-Type', 'Authorization'],
  allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
});

const app = new Hono<{ Bindings: Bindings }>();

app.get('/health', (c) => c.json({ status: 'ok' }));

app.use('/api/v1/*', corsMiddleware);
app.route('/api/v1/consultations', consultationRoutes);
app.route('/api/v1/ai-runs', aiRunEventRoutes);

app.use('/api/auth/*', corsMiddleware);

const authHandler = async (c: Context<{ Bindings: Bindings }>) => {
  if (!c.env?.BETTER_AUTH_SECRET?.trim()) {
    return c.json({ error: 'service not configured' }, 503);
  }
  if (!c.env?.GITHUB_CLIENT_ID?.trim() || !c.env?.GITHUB_CLIENT_SECRET?.trim()) {
    return c.json({ error: 'github oauth not configured' }, 503);
  }

  const baseURL = resolveAuthBaseURL(c.req.raw, new URL(c.req.url).origin, c.env.BETTER_AUTH_URL);
  const auth = createAuth(c.env.DB, {
    secret: c.env.BETTER_AUTH_SECRET,
    baseURL,
    githubClientId: c.env.GITHUB_CLIENT_ID,
    githubClientSecret: c.env.GITHUB_CLIENT_SECRET,
  });
  return auth.handler(c.req.raw);
};

app.on(['GET'], '/api/auth/**', authHandler);
app.on(['POST'], '/api/auth/**', jsonBodyLimit(BODY_LIMITS.auth), authHandler);

app.route('/internal/v1/ai-runs', internalCallbackRoutes);

export default app;
export type AppType = typeof app;
