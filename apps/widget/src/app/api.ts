/** Same-origin API client of the widget. The widget host is the API image, so there is no CORS and no third-party request. Tokens live in memory only. */
export class ApiError extends Error {
  constructor(readonly status: number, readonly code: string, readonly body: Record<string, unknown> = {}) { super(code); }
}
let widgetToken: string | null = null;
let bearer: string | null = null;
export const setWidgetToken = (t: string | null) => { widgetToken = t; };
export const setBearer = (t: string | null) => { bearer = t; };
export const hasBearer = () => bearer !== null;

export async function call<T>(method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' };
  if (widgetToken) headers['X-KX-Widget'] = widgetToken;
  if (bearer) headers.Authorization = `Bearer ${bearer}`;
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  let res: Response;
  try {
    res = await fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), credentials: 'omit', cache: 'no-store', referrerPolicy: 'no-referrer' });
  } catch { throw new ApiError(0, 'OFFLINE'); }
  let json: Record<string, unknown> = {};
  try { json = (await res.json()) as Record<string, unknown>; } catch { /* empty body */ }
  if (!res.ok) throw new ApiError(res.status, typeof json.code === 'string' ? json.code : `HTTP_${res.status}`, json);
  return json as T;
}
export const get = <T,>(p: string) => call<T>('GET', p);
export const post = <T,>(p: string, b?: unknown) => call<T>('POST', p, b ?? {});
