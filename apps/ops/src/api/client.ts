import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { toApiError } from "./errors";

type TokenGetter = () => Promise<string | null>;
let getToken: TokenGetter = async () => null;
let onUnauthorized: () => void = () => {};

export const configureApi = (opts: { getToken: TokenGetter; onUnauthorized?: () => void }) => {
  getToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized ?? (() => {});
};

const auth: Middleware = {
  async onRequest({ request }) {
    const token = await getToken();
    if (token) request.headers.set("Authorization", `Bearer ${token}`);
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) onUnauthorized();
    // Return nothing: openapi-fetch only accepts a *global* Response here, and RN's fetch returns its own Response class.
  },
};

/** Authenticated fetch for endpoints not (yet) in the generated OpenAPI schema (org onboarding). Throws ApiError like unwrap(). */
export async function rawApi<T = unknown>(method: string, path: string, body?: unknown, opts: { binary?: boolean } = {}): Promise<T> {
  const token = await getToken();
  const headers: Record<string, string> = { accept: "application/json" };
  if (token) headers.Authorization = `Bearer ${token}`;
  if (body !== undefined && !opts.binary) headers["content-type"] = "application/json";
  if (opts.binary) headers["content-type"] = "application/octet-stream";
  const res = await globalThis.fetch(`/api/v1${path}`, { method, headers, body: body === undefined ? undefined : opts.binary ? (body as BodyInit) : JSON.stringify(body) });
  if (res.status === 401) onUnauthorized();
  const text = await res.text(); const data = text ? JSON.parse(text) : undefined;
  if (!res.ok) throw toApiError(res.status, data);
  return data as T;
}

export const api = createClient<paths>({ baseUrl: typeof window !== "undefined" ? window.location.origin : "", fetch: (r) => globalThis.fetch(r) });
api.use(auth);

/** Unwraps an openapi-fetch result, throwing a typed ApiError for non-2xx. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}

