import { betterAuth } from 'better-auth';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';

export type WebAuthEnv = {
  DB: D1Database;
  BETTER_AUTH_SECRET?: string;
  BETTER_AUTH_URL?: string;
  GITHUB_CLIENT_ID?: string;
  GITHUB_CLIENT_SECRET?: string;
};

export type SessionShape = {
  user?: { id: string; name?: string | null; email?: string | null; image?: string | null } | null;
  session?: { id: string; expiresAt?: string | Date } | null;
} | null;

export function resolveWebAuthBaseURL(request: Request, env: WebAuthEnv): string {
  const configured = env.BETTER_AUTH_URL?.trim();
  if (configured) return configured.replace(/\/$/u, '');
  return new URL(request.url).origin;
}

export function isWebAuthConfigured(env: WebAuthEnv): boolean {
  return Boolean(
    env.DB &&
      env.BETTER_AUTH_SECRET?.trim() &&
      env.GITHUB_CLIENT_ID?.trim() &&
      env.GITHUB_CLIENT_SECRET?.trim(),
  );
}

export function createWebAuth(env: WebAuthEnv, request: Request) {
  const baseURL = resolveWebAuthBaseURL(request, env);
  const db = new Kysely({ dialect: new D1Dialect({ database: env.DB }) });
  const githubClientId = env.GITHUB_CLIENT_ID?.trim();
  const githubClientSecret = env.GITHUB_CLIENT_SECRET?.trim();

  return betterAuth({
    secret: env.BETTER_AUTH_SECRET ?? '',
    baseURL,
    trustedOrigins: [baseURL, 'http://localhost:5173'],
    database: {
      db: db as any,
      type: 'sqlite',
    },
    socialProviders: githubClientId && githubClientSecret
      ? {
          github: {
            clientId: githubClientId,
            clientSecret: githubClientSecret,
          },
        }
      : {},
  });
}

export async function readWebSession(request: Request, env: WebAuthEnv): Promise<SessionShape> {
  if (!env.BETTER_AUTH_SECRET?.trim()) return null;

  try {
    return (await createWebAuth(env, request).api.getSession({ headers: request.headers })) as SessionShape;
  } catch (error) {
    console.error('web auth session lookup failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return null;
  }
}
