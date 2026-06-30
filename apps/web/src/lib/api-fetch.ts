/**
 * apiFetch — Web serverFn → API Worker 呼び出しヘルパー
 *
 * Service Binding (env.API) を使い、必要に応じて incoming request の
 * Cookie/Authorization を転送する。
 */

type ApiFn = (url: string, init?: RequestInit) => Promise<Response>;

export async function getApi(options?: {
  cookie?: string | null;
  authorization?: string | null;
  forwardedHost?: string | null;
  forwardedProto?: string | null;
}): Promise<ApiFn> {
  const injectHeaders = (init?: RequestInit): RequestInit => {
    if (!options) return init ?? {};
    const headers = new Headers(init?.headers);
    if (options.cookie) headers.set('cookie', options.cookie);
    if (options.authorization) headers.set('authorization', options.authorization);
    if (options.forwardedHost) headers.set('x-forwarded-host', options.forwardedHost);
    if (options.forwardedProto) headers.set('x-forwarded-proto', options.forwardedProto);
    return { ...init, headers };
  };

  try {
    const { env } = (await import('cloudflare:workers')) as unknown as {
      env: { API: { fetch: typeof fetch } };
    };
    return (url: string, init?: RequestInit) =>
      env.API.fetch(`https://api${url}`, injectHeaders(init));
  } catch {
    return (url: string, init?: RequestInit) =>
      fetch(`http://localhost:8787${url}`, injectHeaders(init));
  }
}

export async function getIncomingAuthHeaders(): Promise<{
  cookie: string | null;
  authorization: string | null;
  forwardedHost: string | null;
  forwardedProto: string | null;
}> {
  try {
    const { getRequest } = await import('@tanstack/react-start/server');
    const request = getRequest() as Request;
    const url = new URL(request.url);
    return {
      cookie: request.headers.get('cookie'),
      authorization: request.headers.get('authorization'),
      forwardedHost: request.headers.get('x-forwarded-host') ?? url.host,
      forwardedProto: request.headers.get('x-forwarded-proto') ?? url.protocol.replace(':', ''),
    };
  } catch {
    return { cookie: null, authorization: null, forwardedHost: null, forwardedProto: null };
  }
}

export async function getAuthenticatedApi(): Promise<ApiFn> {
  const auth = await getIncomingAuthHeaders();
  return getApi(auth);
}
