type Fetcher = {
  fetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response>;
};

type Env = {
  API: Fetcher;
  ASSETS: Fetcher;
};

const HOP_BY_HOP_HEADERS = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

function getApiSplat(pathname: string): string | null {
  if (pathname === '/api') return '';
  if (!pathname.startsWith('/api/')) return null;
  return pathname.slice('/api/'.length);
}

function buildUpstreamHeaders(request: Request, url: URL): Headers {
  const headers = new Headers(request.headers);

  headers.delete('host');
  headers.delete('content-length');
  headers.delete('cf-connecting-ip');
  headers.delete('cf-ipcountry');
  headers.delete('cf-ray');
  headers.delete('cf-visitor');
  headers.delete('x-forwarded-host');
  headers.delete('x-forwarded-proto');

  // Keep the proxy conservative while OAuth is being stabilized.
  headers.delete('accept-encoding');

  headers.set('x-forwarded-host', url.host);
  headers.set('x-forwarded-proto', url.protocol.replace(':', ''));

  return headers;
}

function appendSetCookieHeaders(source: Headers, target: Headers): void {
  const getSetCookie = (source as Headers & { getSetCookie?: () => string[] }).getSetCookie;
  const getAll = (source as Headers & { getAll?: (name: string) => string[] }).getAll;
  const cookies = typeof getSetCookie === 'function'
    ? getSetCookie.call(source)
    : typeof getAll === 'function'
      ? getAll.call(source, 'set-cookie')
      : [];

  if (cookies.length === 0) return;

  target.delete('set-cookie');
  for (const cookie of cookies) {
    target.append('set-cookie', cookie);
  }
}

function buildDownstreamHeaders(upstream: Response): Headers {
  const headers = new Headers();

  upstream.headers.forEach((value, key) => {
    const lowerKey = key.toLowerCase();
    if (HOP_BY_HOP_HEADERS.has(lowerKey) || lowerKey === 'set-cookie') return;
    headers.append(key, value);
  });

  appendSetCookieHeaders(upstream.headers, headers);
  headers.set('cache-control', 'no-store');

  return headers;
}

async function proxyApiRequest(request: Request, env: Env, splatPath: string): Promise<Response> {
  const url = new URL(request.url);
  const upstreamUrl = `https://api/api/${splatPath}${url.search}`;
  const upstreamHeaders = buildUpstreamHeaders(request, url);

  const upstreamInit: RequestInit = {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    upstreamInit.body = request.body;
    (upstreamInit as RequestInit & { duplex: 'half' }).duplex = 'half';
  }

  const upstream = await env.API.fetch(upstreamUrl, upstreamInit);
  const headers = buildDownstreamHeaders(upstream);
  const contentType = upstream.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers,
    });
  }

  const body = request.method === 'HEAD' ? null : await upstream.text();

  return new Response(body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);
    const apiSplatPath = getApiSplat(url.pathname);

    if (apiSplatPath !== null) {
      if (!env.API) {
        return Response.json({ error: 'API service unavailable' }, { status: 503 });
      }
      return proxyApiRequest(request, env, apiSplatPath);
    }

    // run_worker_first: ["/api", "/api/*"] なので
    // API以外のパスはWorkerに来ないはずだが、念のためfallback
    return new Response('Not Found', { status: 404 });
  },
};
