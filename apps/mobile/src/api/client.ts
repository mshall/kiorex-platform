import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { toApiError } from "./errors";
import { config } from "@/lib/config";

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
    request.headers.set("Accept-Language", "ar");
    return request;
  },
  async onResponse({ response }) {
    if (response.status === 401) onUnauthorized();
    return response;
  },
};

// Offline fixtures are loaded lazily and only in mock mode.
const mockFetchLazy = async (req: Request) => (await import("@/mocks/mockFetch")).mockFetch(req);

export const api = createClient<paths>({ baseUrl: config.apiOrigin, ...(config.mock ? { fetch: mockFetchLazy } : {}) });
api.use(auth);

/** Unwraps an openapi-fetch result, throwing a typed ApiError for non-2xx. The spec leaves bodies untyped, so T is asserted by the caller's adapter. */
export async function send<T = Record<string, any>>(p: Promise<{ data?: unknown; error?: unknown; response: Response }>): Promise<T> { // eslint-disable-line @typescript-eslint/no-explicit-any
  const { data, error, response } = await p;
  if (!response.ok) throw toApiError(response.status, error);
  return data as T;
}
