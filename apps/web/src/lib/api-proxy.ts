/**
 * proxyApiRequest — Web Worker → API Worker proxy helper
 *
 * ブラウザからの /api/* を Service Binding 経由で API Worker へ転送する。
 * body/header/Set-Cookie/SSE stream を透過的に扱う。
 */

const HOP_BY_HOP = new Set([
  'connection',
  'keep-alive',
  'proxy-authenticate',
  'proxy-authorization',
  'te',
  'trailer',
  'transfer-encoding',
  'upgrade',
]);

type ProxyRequestInit = RequestInit & {
  duplex?: 'half';
};

function buildUpstreamHeaders(incoming: Headers): Headers {
  const out = new Headers();
  incoming.forEach((value, key) => {
    if (!HOP_BY_HOP.has(key.toLowerCase())) out.set(key, value);
  });
  out.delete('host');
  return out;
}

function getSetCookieValues(headers: Headers): string[] {
  const h = headers as Headers & {
    getAll?: (name: string) => string[];
    getSetCookie?: () => string[];
  };
  if (typeof h.getAll === 'function') return h.getAll('Set-Cookie');
  if (typeof h.getSetCookie === 'function') return h.getSetCookie();
  const single = headers.get('set-cookie');
  return single ? [single] : [];
}

function buildDownstreamResponse(upstream: Response): Response {
  const headers = new Headers();
  upstream.headers.forEach((value, key) => {
    if (key.toLowerCase() === 'set-cookie') return;
    if (!HOP_BY_HOP.has(key.toLowerCase())) headers.append(key, value);
  });
  for (const cookie of getSetCookieValues(upstream.headers)) {
    headers.append('set-cookie', cookie);
  }
  return new Response(upstream.body, {
    status: upstream.status,
    statusText: upstream.statusText,
    headers,
  });
}

export async function proxyApiRequest(
  request: Request,
  api: { fetch: (input: RequestInfo, init?: RequestInit) => Promise<Response> },
  splatPath: string,
): Promise<Response> {
  const url = new URL(request.url);
  const upstreamUrl = `https://api/api/${splatPath}${url.search}`;
  const upstreamHeaders = buildUpstreamHeaders(request.headers);

  upstreamHeaders.set('x-forwarded-host', url.host);
  upstreamHeaders.set('x-forwarded-proto', url.protocol.replace(':', ''));

  const upstreamInit: ProxyRequestInit = {
    method: request.method,
    headers: upstreamHeaders,
    redirect: 'manual',
  };

  if (request.method !== 'GET' && request.method !== 'HEAD') {
    upstreamInit.body = request.body;
    upstreamInit.duplex = 'half';
  }

  const upstream = await api.fetch(upstreamUrl, upstreamInit);
  return buildDownstreamResponse(upstream);
}
