import type { Locale, PublicPageType } from "./types";

/**
 * The single public route table (GRW-P1-E). It lists ONLY public, crawlable page types; every other SPA route is private or transactional and is
 * either `noindex` or disallowed (see PRIVATE_SPA_ROUTES and the route snapshot test). The API url-policy (apps/api/src/public-site/url-policy.ts)
 * owns canonical URLs, hreflang, sitemaps and redirects; a parity test keeps both tables identical.
 */
export interface PublicRoute { type: Exclude<PublicPageType, "not-found">; pattern: string; enabled: boolean }

export const PUBLIC_ROUTES: readonly PublicRoute[] = [
  { type: "home", pattern: "", enabled: true },
  { type: "hub", pattern: "doctors/:specialty", enabled: true },
  { type: "city", pattern: "doctors/:specialty/:city", enabled: true },
  { type: "district", pattern: "doctors/:specialty/:city/:district", enabled: true },
  { type: "care-district", pattern: ":care/:city/:district", enabled: true },
  { type: "city-hub", pattern: "locations/:city", enabled: true },
  { type: "district-hub", pattern: "locations/:city/:district", enabled: true },
  { type: "same-day", pattern: "same-day/:specialty", enabled: true },
  { type: "telemedicine", pattern: "telemedicine/:specialty", enabled: true },
  { type: "doctor", pattern: "doctor/:slug", enabled: true },
  { type: "clinic", pattern: "clinic/:slug", enabled: true },
  { type: "nurse", pattern: "nurse/:slug", enabled: true },
  { type: "pharmacy", pattern: "pharmacy/:slug", enabled: true },
  { type: "lab", pattern: "lab/:slug", enabled: true },
];

const SLUG = "[a-z0-9-]{2,60}";
const compiled = PUBLIC_ROUTES.map((def) => {
  const names: string[] = [];
  const src = def.pattern.split("/").map((seg) => {
    if (!seg.startsWith(":")) return seg;
    const n = seg.slice(1);
    names.push(n);
    return n === "care" ? "(home-nursing|physiotherapy)" : `(${SLUG})`;
  }).join("\\/");
  return { def, names, re: new RegExp(`^${src}$`) };
});

export interface PublicMatch { locale: Locale; cc: string; type: PublicRoute["type"]; params: Record<string, string>; rest: string; enabled: boolean }

export function matchPublicPath(pathname: string): PublicMatch | null {
  const m = /^\/(ar|en)\/([a-z]{2})(\/.*)?$/.exec(pathname);
  if (!m) return null;
  const rest = (m[3] ?? "").replace(/^\//, "");
  for (const { def, names, re } of compiled) {
    const r = re.exec(rest);
    if (!r) continue;
    const params: Record<string, string> = {};
    names.forEach((n, i) => { params[n] = r[i + 1]!; });
    return { locale: m[1] as Locale, cc: m[2]!, type: def.type, params, rest, enabled: def.enabled };
  }
  return null;
}

/** Build the same path the API canonical builder produces. */
export function publicPath(locale: Locale, cc: string, type: PublicRoute["type"], params: Record<string, string> = {}): string {
  const def = PUBLIC_ROUTES.find((r) => r.type === type)!;
  const rest = def.pattern.split("/").filter(Boolean).map((seg) => (seg.startsWith(":") ? params[seg.slice(1)] ?? "" : seg)).join("/");
  return `/${locale}/${cc.toLowerCase()}${rest ? `/${rest}` : ""}`;
}

/**
 * Every route of the authenticated/transactional SPA (apps/web/src/App.tsx). None of them is rendered by the public site; the SPA shell carries
 * `noindex` and robots.txt disallows them. The snapshot test fails when App.tsx gains a route that is in neither table.
 */
export const PRIVATE_SPA_ROUTES = [
  // inside the public namespace but client-rendered: the API answers the SPA shell (noindex), see SPA_PASSTHROUGH_PAGES in the API url-policy
  "/preferences", "/:locale/:cc/preferences", "/invite/:code", "/:locale/:cc/invite/:code",
  "/auth/callback", "/visit-status/:token", "/search", "/doctors/:id", "/checkout/:bookingId", "/appointments", "/appointments/:id", "/appointments/:id/review", "/services",
  "/waitlist", "/records", "/records/:id", "/pharmacy", "/pharmacy/orders", "/pharmacy/orders/:id", "/lab", "/lab/bookings", "/lab/bookings/:id", "/telemedicine",
  "/telemedicine/:id", "/telemedicine/:id/room", "/account", "/notifications", "/account/addresses", "/care-plans", "/referral", "/referral/rewards", "/corporate", "/loyalty",
] as const;

/** Pages under /{locale}/{cc}/ that the SPA renders itself (mirrors SPA_PASSTHROUGH_PAGES in the API). */
export const SPA_PASSTHROUGH_PAGES = ["preferences", "invite/:code"] as const;
