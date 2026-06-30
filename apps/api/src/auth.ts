import { betterAuth } from 'better-auth';
import { Kysely } from 'kysely';
import { D1Dialect } from 'kysely-d1';

export type AuthRuntimeConfig = {
  secret: string;
  baseURL: string;
  githubClientId?: string;
  githubClientSecret?: string;
};

export function createAuth(d1: D1Database, config: AuthRuntimeConfig) {
  const db = new Kysely({ dialect: new D1Dialect({ database: d1 }) });
  const githubClientId = config.githubClientId?.trim();
  const githubClientSecret = config.githubClientSecret?.trim();

  return betterAuth({
    secret: config.secret,
    baseURL: config.baseURL,
    trustedOrigins: [
      'https://aimani-gs-web.masa-nekoshinshi39.workers.dev',
      'http://localhost:5173',
    ],
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

export type SessionResult =
  | { ok: true; user: { id: string; name: string; email?: string | null } }
  | { ok: false; reason: 'missing_session' }
  | { ok: false; reason: 'auth_misconfigured' }
  | { ok: false; reason: 'auth_failure' };

/**
 * リバースプロキシ経由のリクエストから元の origin を復元する。
 * X-Forwarded-Host があればそちらを優先し、なければ fallback を使う。
 */
export function resolveExternalBaseURL(
  request: Request,
  fallbackBaseURL: string,
): string {
  const forwardedHost = request.headers.get('x-forwarded-host');
  if (!forwardedHost) return fallbackBaseURL;

  // Service Binding 内部 origin からのリクエストのみ forwarded headers を信じる
  const fallbackHostname = new URL(fallbackBaseURL).hostname;
  const TRUSTED_INTERNAL = new Set(['api', 'localhost', '127.0.0.1']);
  if (!TRUSTED_INTERNAL.has(fallbackHostname)) return fallbackBaseURL;

  const forwardedProto = request.headers.get('x-forwarded-proto') ?? 'https';
  if (forwardedProto !== 'http' && forwardedProto !== 'https') return fallbackBaseURL;

  return `${forwardedProto}://${forwardedHost}`;
}

export function resolveAuthBaseURL(
  request: Request,
  fallbackBaseURL: string,
  configuredBaseURL?: string,
): string {
  const configured = configuredBaseURL?.trim();
  if (configured) return configured.replace(/\/$/u, '');
  return resolveExternalBaseURL(request, fallbackBaseURL);
}

export async function getSessionResult(
  d1: D1Database,
  config: Omit<AuthRuntimeConfig, 'baseURL'>,
  baseURL: string,
  request: Request,
): Promise<SessionResult> {
  if (!config.secret?.trim()) return { ok: false, reason: 'auth_misconfigured' };

  try {
    const auth = createAuth(d1, { ...config, baseURL });
    const session = await auth.api.getSession({ headers: request.headers });
    if (session?.user) {
      return {
        ok: true,
        user: {
          id: session.user.id,
          name: session.user.name,
          email: session.user.email,
        },
      };
    }
    return { ok: false, reason: 'missing_session' };
  } catch (error) {
    console.error('auth session lookup failed', {
      name: error instanceof Error ? error.name : 'UnknownError',
    });
    return { ok: false, reason: 'auth_failure' };
  }
}
