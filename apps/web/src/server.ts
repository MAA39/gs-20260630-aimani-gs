import handler from '@tanstack/react-start/server-entry';
import { proxyApiRequest } from './lib/api-proxy';

type ApiBinding = {
  fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response>;
};

type Env = {
  API?: ApiBinding;
};

function getApiSplatPath(pathname: string): string | null {
  if (pathname === '/api') return '';
  if (pathname.startsWith('/api/')) return pathname.slice('/api/'.length);
  return null;
}

function jsonError(status: number, error: string): Response {
  return new Response(JSON.stringify({ error }), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
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
