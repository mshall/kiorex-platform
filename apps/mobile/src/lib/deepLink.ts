// GRW-P1-H: deep link resolution for the Kiorex patient app. Pure and dependency free (unit tested with malicious inputs).
// Contract: a link is matched against a CLOSED route table; the output is always an in-app path built from a fixed template plus validated
// segments. Unknown or invalid links open Home. No URL-valued parameter is ever read, followed or forwarded (no open redirect), the link never
// carries a token, and resolving a link never signs anyone in, links or merges accounts: routes that show personal data require the existing session.
// The same rules exist on the server in apps/api/src/market/deep-link-rules.ts.

export type LinkKind = "home" | "doctor" | "clinic" | "referral" | "provider" | "invite" | "appointment" | "claim" | "auth" | "visit-status";
export interface LinkRef { kind: "referral" | "provider"; code: string }
export interface LinkTarget {
  kind: LinkKind;
  /** In-app path (expo-router). Always starts with "/" and is built from templates; never contains a scheme or host. */
  route: string;
  /** True when the target shows personal data and needs the existing sign-in (the link itself never signs in). */
  requiresSignIn: boolean;
  ref?: LinkRef;
  /** Lower case market code of the link, already reconciled with the live markets (a non-live market falls back to the default). */
  cc?: string;
  locale?: "ar" | "en";
}
export interface ResolveOptions {
  /** Allowed web hosts (exact, lower case). */
  hosts?: readonly string[];
  /** Accept http for hosts that are localhost (development builds only). */
  allowInsecureLocal?: boolean;
  liveMarkets?: readonly string[];
  defaultMarket?: string;
}

export const HOME: LinkTarget = { kind: "home", route: "/", requiresSignIn: false };
const SCHEMES = ["kiorex"];
const LOCALES = ["ar", "en"];

export const PROVIDER_CODE_RE = /^[0-9A-HJKMNP-TV-Z]{8}$/;
export const REF_CODE_RE = /^[0-9A-Za-z]{4,16}$/;
export const SEGMENT_RE = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const CC_RE = /^[a-z]{2}$/;

/** Hosts come from the build (EAS env), never from the link. */
export function configuredHosts(env: string | undefined = process.env.EXPO_PUBLIC_LINK_HOSTS): string[] {
  const list = (env ?? "kiorex.com,www.kiorex.com,kiorly.link").split(",").map((h) => h.trim().toLowerCase()).filter((h) => /^[a-z0-9.-]+(:\d{1,5})?$/.test(h));
  return list;
}

const decodeOnce = (s: string): string | null => { try { return decodeURIComponent(s); } catch { return null; } };
/** A decoded path segment must be a plain token: no separators, no dots-only, no control or percent leftovers (double encoding), no whitespace. */
function cleanSegment(raw: string): string | null {
  const d = decodeOnce(raw);
  if (d === null || d.includes("%") || /[\\/\u0000-\u001f\u007f\s]/.test(d)) return null;
  return d;
}

export function normalizeProviderCode(v: string): string | null { const u = v.toUpperCase(); return v.length === 8 && PROVIDER_CODE_RE.test(u) ? u : null; }

interface Parts { scheme: string; host: string; path: string; query: string }
function splitUrl(raw: string): Parts | null {
  if (raw.length > 2048 || /[\u0000-\u001f\u007f\\]/.test(raw)) return null;
  const m = /^([a-zA-Z][a-zA-Z0-9+.-]*):\/\/([^/?#]*)([^?#]*)(?:\?([^#]*))?(?:#.*)?$/.exec(raw.trim());
  if (!m) return null;
  return { scheme: m[1]!.toLowerCase(), host: m[2]!, path: m[3] ?? "", query: m[4] ?? "" };
}
function queryParam(query: string, name: string): string | null {
  for (const pair of query.split("&")) {
    const i = pair.indexOf("=");
    const k = i < 0 ? pair : pair.slice(0, i);
    if (k === name) return cleanSegment(i < 0 ? "" : pair.slice(i + 1));
  }
  return null;
}

function market(cc: string | null, o: ResolveOptions): string | undefined {
  const live = (o.liveMarkets ?? []).map((m) => m.toLowerCase());
  if (!live.length) return undefined; // bootstrap unknown: the app keeps its own market, a link never invents one
  if (cc && CC_RE.test(cc) && live.includes(cc)) return cc; // the link market wins when it is live
  const def = (o.defaultMarket ?? "").toLowerCase();
  return live.includes(def) ? def : live[0];
}

const AUTH_PARAMS = ["code", "state", "error", "error_description", "session_state", "iss"];
/**
 * The OIDC redirect back from Kiorex Passport (`kiorex://auth/callback?code=...&state=...`, `kiorex://auth/logout`) is part of the existing sign-in flow and must keep working.
 * Only the standard OIDC parameters are carried, re-encoded, and only for the custom scheme (never a web host). This is the person's own sign-in completing
 * (PKCE, state checked by the auth screen); it does not log anyone in by itself and no other parameter is passed on.
 */
function authTarget(which: string, query: string): LinkTarget {
  const kept: string[] = [];
  for (const pair of query.split("&")) {
    const i = pair.indexOf("=");
    const k = i < 0 ? pair : pair.slice(0, i);
    if (!AUTH_PARAMS.includes(k)) continue;
    const v = decodeOnce(i < 0 ? "" : pair.slice(i + 1));
    if (v !== null && v.length <= 2048 && !/[\u0000-\u001f\u007f]/.test(v)) kept.push(`${k}=${encodeURIComponent(v)}`);
  }
  return { kind: "auth", route: `/auth/${which}${kept.length ? `?${kept.join("&")}` : ""}`, requiresSignIn: false };
}

/** Resolves a path (already stripped of scheme and host) against the route table. `fromScheme` lets the custom scheme use the same table. */
function matchPath(pathRaw: string, query: string, o: ResolveOptions, fromScheme = false): LinkTarget {
  const segs = pathRaw.split("/").filter((s) => s !== "");
  if (!segs.length || segs.length > 6) return HOME;
  const clean: string[] = [];
  for (const s of segs) { const c = cleanSegment(s); if (c === null) return HOME; clean.push(c); }
  let locale: "ar" | "en" | undefined;
  let linkCc: string | null = queryParam(query, "cc");
  if (LOCALES.includes(clean[0]!.toLowerCase()) && clean.length >= 3 && CC_RE.test(clean[1]!.toLowerCase())) {
    locale = clean[0]!.toLowerCase() as "ar" | "en"; linkCc = clean[1]!.toLowerCase(); clean.splice(0, 2);
  }
  const [head, arg, ...rest] = clean;
  const cc = market(linkCc, o);
  const base = { ...(cc ? { cc } : {}), ...(locale ? { locale } : {}) };
  if (fromScheme && head === "auth" && (arg === "callback" || arg === "logout") && !rest.length) return authTarget(arg, query);
  if (fromScheme && head === "visit-status" && arg && !rest.length && /^[A-Za-z0-9_-]{8,128}$/.test(arg)) return { kind: "visit-status", route: `/visit-status/${arg}`, requiresSignIn: false };
  if (head === "claim" && !arg) return { kind: "claim", route: "/claim", requiresSignIn: false, ...base };
  if (!head || !arg || rest.length) return HOME;
  switch (head.toLowerCase()) {
    case "doctor": return SEGMENT_RE.test(arg) ? { kind: "doctor", route: `/doctor/${arg}`, requiresSignIn: false, ...base } : HOME;
    case "clinic": return SEGMENT_RE.test(arg) ? { kind: "clinic", route: `/results?q=${encodeURIComponent(arg.replace(/[-_]+/g, " ").trim())}`, requiresSignIn: false, ...base } : HOME;
    case "r": return REF_CODE_RE.test(arg) ? { kind: "referral", route: `/r/${arg}`, requiresSignIn: false, ref: { kind: "referral", code: arg }, ...base } : HOME;
    case "invite": { const c = arg.toUpperCase(); return PROVIDER_CODE_RE.test(c) ? { kind: "invite", route: `/invite/${c}`, requiresSignIn: false, ...base } : HOME; } // GRW-P2-B3: patient invite (Crockford, 8 characters); the screen claims it after sign-in, the link itself never does
    case "q": { const code = normalizeProviderCode(arg); return code ? { kind: "provider", route: `/r/${code}?k=p`, requiresSignIn: false, ref: { kind: "provider", code }, ...base } : HOME; }
    case "appointment": case "a": return SEGMENT_RE.test(arg) ? { kind: "appointment", route: `/appointment/${arg}`, requiresSignIn: true, ...base } : HOME;
    default: return HOME;
  }
}

/** Resolves any incoming URL or path. Never throws; anything unexpected returns Home. */
export function resolveLink(raw: unknown, o: ResolveOptions = {}): LinkTarget {
  if (typeof raw !== "string" || !raw) return HOME;
  try {
    const trimmed = raw.trim();
    if (trimmed.startsWith("//")) return HOME; // protocol-relative: never a valid app path
    if (trimmed.startsWith("/")) { // a bare path: the OS only hands us paths of verified associated domains
      const q = trimmed.indexOf("?"); const h = trimmed.indexOf("#");
      const end = Math.min(...[q, h, trimmed.length].filter((n) => n >= 0));
      return matchPath(trimmed.slice(0, end), q >= 0 ? trimmed.slice(q + 1, h >= 0 && h > q ? h : undefined) : "", o);
    }
    const p = splitUrl(trimmed);
    if (!p) return HOME;
    if (SCHEMES.includes(p.scheme)) { // kiorex://doctor/slug -> authority is the first path segment
      if (/[@:]/.test(p.host)) return HOME;
      return matchPath(`/${p.host}${p.path}`, p.query, o, true);
    }
    if (p.scheme !== "https" && !(p.scheme === "http" && o.allowInsecureLocal && /^(localhost|127\.0\.0\.1)(:\d+)?$/i.test(p.host))) return HOME;
    if (p.host.includes("@") || p.host.includes("%")) return HOME; // userinfo tricks: kiorex.com@evil.example
    const hosts = (o.hosts ?? configuredHosts()).map((h) => h.toLowerCase());
    if (!hosts.includes(p.host.toLowerCase())) return HOME;
    return matchPath(p.path, p.query, o);
  } catch { return HOME; }
}

/** Android Play install referrer: `kxref=<p|r>.<code>` (utm parameters Play adds are ignored). Returns null for anything else. */
export function parseInstallReferrer(raw: unknown): LinkRef | null {
  if (typeof raw !== "string" || raw.length > 512) return null;
  for (const pair of raw.split("&")) {
    const i = pair.indexOf("=");
    if (i < 0) continue;
    const k = decodeOnce(pair.slice(0, i));
    if (k !== "kxref") continue;
    const v = decodeOnce(pair.slice(i + 1));
    const m = v ? /^(?:([pr])\.)?([0-9A-Za-z]{4,16})$/.exec(v) : null;
    if (!m) return null;
    const code = m[2]!;
    if (m[1] === "p") { const c = normalizeProviderCode(code); return c ? { kind: "provider", code: c } : null; }
    if (m[1] === "r") return { kind: "referral", code };
    const c = normalizeProviderCode(code);
    return c && code === code.toUpperCase() ? { kind: "provider", code: c } : { kind: "referral", code };
  }
  return null;
}

/** First-launch claim code typed or pasted by the person (iOS has no install referrer). */
export function parseClaimCode(raw: unknown): LinkRef | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim().replace(/[\s-]/g, "");
  if (!v || v.length > 16) return null;
  const p = normalizeProviderCode(v);
  if (p) return { kind: "provider", code: p };
  return REF_CODE_RE.test(v) ? { kind: "referral", code: v } : null;
}
