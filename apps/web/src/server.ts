import handler from '@tanstack/react-start/server-entry';
import { proxyApiRequest } from './lib/api-proxy';
import { createWebAuth, isWebAuthConfigured, readWebSession, resolveWebAuthBaseURL } from './lib/auth';
import type { WebAuthEnv } from './lib/auth';

type ApiBinding = {
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

type Env = WebAuthEnv & {
  API?: ApiBinding;
};

function getApiSplatPath(pathname: string): string | null {
  if (pathname === '/api') return '';
  if (pathname.startsWith('/api/')) return pathname.slice('/api/'.length);
  return null;
}

function isAuthPath(pathname: string): boolean {
  return pathname === '/api/auth' || pathname.startsWith('/api/auth/');
}

function isDebugSessionPath(pathname: string): boolean {
  return pathname === '/api/debug/session';
}

function json(data: unknown, init?: ResponseInit): Response {
  return new Response(JSON.stringify(data), {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
}

function jsonError(status: number, error: string): Response {
  return json({ error }, { status });
}

async function handleAuthRequest(request: Request, env: Env): Promise<Response> {
  if (!isWebAuthConfigured(env)) {
    return jsonError(503, 'auth service not configured');
  }

  return createWebAuth(env, request).handler(request);
}

async function handleDebugSession(request: Request, env: Env): Promise<Response> {
  const baseURL = resolveWebAuthBaseURL(request, env);
  return json({
    ok: true,
    worker: 'web',
    baseURL,
    callbackURL: `${baseURL}/api/auth/callback/github`,
    session: await readWebSession(request, env),
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (isAuthPath(url.pathname)) {
      try {
        return await handleAuthRequest(request, env);
      } catch (error) {
        console.error('Web auth handler error', {
          path: url.pathname,
          name: error instanceof Error ? error.name : 'Unknown',
        });
        return jsonError(500, 'auth service error');
      }
    }

    if (isDebugSessionPath(url.pathname)) {
      return handleDebugSession(request, env);
    }

    const apiSplatPath = getApiSplatPath(url.pathname);

    if (apiSplatPath !== null) {
      if (!env.API) {
        return jsonError(503, 'API service unavailable');
      }

      try {
        return await proxyApiRequest(request, env.API, apiSplatPath);
      } catch (error) {
        console.error('Worker-level API proxy error', {
          path: url.pathname,
          name: error instanceof Error ? error.name : 'Unknown',
        });
        return jsonError(503, 'API service unavailable');
      }
    }

    return handler.fetch(request);
  },
};
