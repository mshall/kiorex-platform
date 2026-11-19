import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { toApiError } from "./errors";
import { getMarket } from "@/lib/market";

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
    request.headers.set("X-Kiorex-Market", getMarket());
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) onUnauthorized();
    return response;
  },
};

export const api = createClient<paths>({ baseUrl: typeof window !== "undefined" ? window.location.origin : "", fetch: (r) => globalThis.fetch(r) });
api.use(auth);

/** Unwraps an openapi-fetch result, throwing a typed ApiError for non-2xx. */
export async function unwrap<T>(p: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<T> {
  const { data, error, response } = await p;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}

/** Authenticated raw fetch (blob downloads such as vault files); same market header as the typed client. */
export async function authedBlob(path: string): Promise<Blob> {
  const token = await getToken();
  const r = await fetch(path, { headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), "X-Kiorex-Market": getMarket() } });
  if (!r.ok) throw toApiError(r.status, await r.json().catch(() => null));
  return r.blob();
}
