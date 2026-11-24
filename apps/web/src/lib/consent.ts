/**
 * Visitor consent for the public web (GRW-P1-I). Framework-free so the SPA, the SSR client entry and tests share one implementation.
 *
 * Rules (ARCH 6.2, 9): nothing is stored or sent about a visitor before they choose; Accept and Reject carry equal weight; nothing is pre-ticked;
 * the choice is stored WITH the version of the wording that was shown, and is asked again when that version changes; withdrawal is immediate.
 * The only thing sent to the server is the audit decision (POST /api/v1/growth/v1/consent) and, after an accept, `X-KX-Consent: analytics` on touches.
 */
export const CONSENT_STORAGE_KEY = "kx-consent";
export const CONSENT_OPEN_EVENT = "kx:consent:open";
export const CONSENT_CHANGED_EVENT = "kx:consent:changed";
/** Wording is NEEDS_HUMAN until counsel approves it; every record carries this id until then. */
export const CONSENT_TEXT_PLACEHOLDER = "TODO_NEEDS_HUMAN_v0";

export interface StoredConsent { v: 1; textVersion: string; analytics: boolean; marketing: boolean; consentId: string | null; at: string }
export interface ConsentChoice { analytics: boolean; marketing: boolean }

const isRecord = (x: unknown): x is Record<string, unknown> => !!x && typeof x === "object";

export function readConsent(storage: Pick<Storage, "getItem"> | undefined = safeStorage()): StoredConsent | null {
  try {
    const raw = storage?.getItem(CONSENT_STORAGE_KEY);
    if (!raw) return null;
    const p: unknown = JSON.parse(raw);
    if (!isRecord(p) || p.v !== 1 || typeof p.analytics !== "boolean" || typeof p.marketing !== "boolean" || typeof p.textVersion !== "string") return null;
    return { v: 1, textVersion: p.textVersion, analytics: p.analytics, marketing: p.marketing, consentId: typeof p.consentId === "string" ? p.consentId : null, at: typeof p.at === "string" ? p.at : "" };
  } catch { return null; }
}

function safeStorage(): Storage | undefined {
  try { return typeof window !== "undefined" ? window.localStorage : undefined; } catch { return undefined; }
}

/** The banner shows when nothing was chosen yet or the stored choice was made under older wording. */
export const needsDecision = (stored: StoredConsent | null, currentTextVersion: string): boolean => !stored || stored.textVersion !== currentTextVersion;

export function writeConsent(c: StoredConsent, storage: Pick<Storage, "setItem"> | undefined = safeStorage()) {
  try { storage?.setItem(CONSENT_STORAGE_KEY, JSON.stringify(c)); } catch { /* private mode: the choice then applies to this page view only */ }
  if (typeof window !== "undefined") window.dispatchEvent(new CustomEvent(CONSENT_CHANGED_EVENT, { detail: c }));
}

/** Headers for first-party growth calls: the analytics header exists ONLY while analytics consent is granted. */
export const consentHeaders = (c: StoredConsent | null = readConsent()): Record<string, string> => (c?.analytics ? { "X-KX-Consent": "analytics" } : {});

export const openConsentPreferences = () => { if (typeof window !== "undefined") window.dispatchEvent(new Event(CONSENT_OPEN_EVENT)); };

interface Versions { analytics: string; marketing: string }
export async function fetchTextVersions(fetchFn: typeof fetch = globalThis.fetch.bind(globalThis)): Promise<Versions> {
  try {
    const r = await fetchFn("/api/v1/growth/v1/consent/versions", { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(String(r.status));
    const b = (await r.json()) as Partial<Versions>;
    return { analytics: b.analytics ?? CONSENT_TEXT_PLACEHOLDER, marketing: b.marketing ?? CONSENT_TEXT_PLACEHOLDER };
  } catch { return { analytics: CONSENT_TEXT_PLACEHOLDER, marketing: CONSENT_TEXT_PLACEHOLDER }; }
}

/**
 * Stores the choice, then records the audit decision. The local choice is applied FIRST (a failing network never keeps a rejected visitor tracked);
 * the audit call is best effort. A reject also tells the server so it can clear any `kxv` cookie.
 */
export async function saveConsent(choice: ConsentChoice, textVersion: string, opts: { evidence: string; source?: "web" | "app" | "widget"; fetchFn?: typeof fetch; storage?: Storage }): Promise<StoredConsent> {
  const next: StoredConsent = { v: 1, textVersion, analytics: choice.analytics, marketing: choice.marketing, consentId: null, at: new Date().toISOString() };
  writeConsent(next, opts.storage);
  try {
    const f = opts.fetchFn ?? globalThis.fetch.bind(globalThis);
    const r = await f("/api/v1/growth/v1/consent", { method: "POST", headers: { "Content-Type": "application/json" }, credentials: "same-origin", body: JSON.stringify({ analytics: choice.analytics, marketing: choice.marketing, textVersion, source: opts.source ?? "web", evidence: opts.evidence }) });
    if (r.ok) { const b = (await r.json()) as { consentId?: string }; if (b.consentId) { const withId = { ...next, consentId: b.consentId }; writeConsent(withId, opts.storage); return withId; } }
  } catch { /* offline: the choice is still honoured locally */ }
  return next;
}

const LANDING: Array<[RegExp, string]> = [[/^\/doctors\//, "DOCTOR"], [/^\/search/, "HOME"], [/^\/$/, "HOME"]];
/** Landing kind for a SPA path (the SSR pages pass their own). */
export const landingKindFor = (pathname: string): string => LANDING.find(([re]) => re.test(pathname))?.[1] ?? "OTHER";

const UTM_KEYS = ["source", "medium", "campaign", "content", "term"] as const;
const UTM_OK = /^[A-Za-z0-9_.~:+/-]{1,64}$/;
/** Builds the /touch body from the URL: only known UTM keys with safe values, the provider ref and the in-session lt token. Nothing else leaves the browser. */
export function touchBodyFrom(search: string, pathname: string, dwellMs?: number): Record<string, unknown> {
  const q = new URLSearchParams(search);
  const utm: Record<string, string> = {};
  for (const k of UTM_KEYS) { const v = q.get(`utm_${k}`); if (v && UTM_OK.test(v)) utm[k] = v; }
  const ref = q.get("ref"); const lt = q.get("lt");
  const body: Record<string, unknown> = { landingKind: ref ? "PROVIDER_LINK" : landingKindFor(pathname) };
  if (Object.keys(utm).length) body.utm = utm;
  if (ref && /^[0-9A-Za-z]{4,16}$/.test(ref)) body.ref = ref;
  if (lt && lt.length <= 512) body.lt = lt;
  if (typeof dwellMs === "number") body.dwellMs = Math.max(0, Math.min(600_000, Math.round(dwellMs)));
  return body;
}

/** One touch per page view, and ONLY with analytics consent. Without it this function does nothing at all (no request, no storage). */
export async function sendTouch(body: Record<string, unknown>, fetchFn: typeof fetch = globalThis.fetch.bind(globalThis), c: StoredConsent | null = readConsent()): Promise<boolean> {
  if (!c?.analytics) return false;
  try { const r = await fetchFn("/api/v1/growth/v1/touch", { method: "POST", headers: { "Content-Type": "application/json", ...consentHeaders(c) }, credentials: "same-origin", body: JSON.stringify(body), keepalive: true }); return r.ok; } catch { return false; }
}
