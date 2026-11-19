import createClient, { type Middleware } from "openapi-fetch";
import type { paths } from "./schema";
import { toApiError } from "./errors";
import { config } from "@/lib/config";
import i18n from "@/i18n";

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
    request.headers.set("Accept-Language", i18n.language?.startsWith("en") ? "en" : "ar");
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

/** Unwraps an openapi-fetch result, throwing a typed ApiError for non-2xx. The 2xx body type comes from the generated spec. */
export async function send<D>(p: Promise<{ data?: D; error?: unknown; response: Response }>): Promise<NonNullable<D>> {
  const { data, error, response } = await p;
  if (!response.ok) throw toApiError(response.status, error);
  return data as NonNullable<D>;
}
