// First-run onboarding rules (pure, unit tested). No medical data; the server side uses only existing endpoints (/me/profile, /me/preferences).
// "Onboarded" is decided from what the SERVER already knows, so a new browser or phone skips it too:
//   1. a recorded preference decision (reminders or analytics `updatedAt` is set; the last onboarding step and "Skip setup" always write one, an explicit "no" is a decision), or
//   2. an account that is not new (created more than NEW_ACCOUNT_MINUTES before now): existing users never see the flow.
// The device keeps only convenience: the step to resume at, the draft interests, and a per-account "done" marker.
import type { PreferencesView } from "@/api/consent";

export const NEW_ACCOUNT_MINUTES = 120;
export const INTERESTS = ["doctors", "labs", "pharmacy", "tele", "physio", "homeNursing"] as const;
export type Interest = (typeof INTERESTS)[number];
export const INTEREST_LINK: Record<Interest, string> = {
  doctors: "/search", labs: "/lab", pharmacy: "/pharmacy", tele: "/telemedicine", physio: "/search?careType=PHYSIOTHERAPY", homeNursing: "/search?careType=HOME_NURSING&serviceLocation=HOME",
};
export const TOTAL_STEPS = 6; // welcome, name, language and place, interests, privacy, notifications

export interface OnboardingFacts { createdAt?: string | null; prefs?: Pick<PreferencesView, "reminders" | "analytics"> | null; deviceDone?: boolean; now?: number }

export function isOnboarded(f: OnboardingFacts): boolean {
  if (f.deviceDone) return true;
  if (f.prefs && (f.prefs.reminders.updatedAt || f.prefs.analytics.updatedAt)) return true;
  if (f.createdAt) {
    const t = Date.parse(f.createdAt);
    if (Number.isFinite(t) && (f.now ?? Date.now()) - t > NEW_ACCOUNT_MINUTES * 60_000) return true;
  }
  return false;
}

/** Only same-origin relative paths may be used as a return target (open-redirect guard); anything else becomes "/". */
export function safeNext(next: string | null | undefined): string {
  if (!next || !next.startsWith("/") || next.startsWith("//") || next.startsWith("/\\") || /^\/(auth|welcome|signin|join)(\/|\?|$)/.test(next)) return "/";
  return next;
}

export const nameField = (name: string): { nameAr: string } | { nameEn: string } => (/[؀-ۿ]/.test(name) ? { nameAr: name } : { nameEn: name });
export const cleanName = (raw: string): string => raw.replace(/\s+/g, " ").trim();
export const validName = (raw: string): boolean => cleanName(raw).length <= 80;

const key = (sub: string, k: string) => `kx-ob:${sub}:${k}`;
const get = (k: string): string | null => { try { return localStorage.getItem(k); } catch { return null; } };
const set = (k: string, v: string | null) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* storage may be blocked */ } };
export const getStep = (sub: string): number => Math.min(TOTAL_STEPS - 1, Math.max(0, Number(get(key(sub, "step"))) || 0));
export const setStep = (sub: string, n: number) => set(key(sub, "step"), String(n));
export const isDeviceDone = (sub: string) => get(key(sub, "done")) === "1";
export const markDeviceDone = (sub: string) => { set(key(sub, "done"), "1"); set(key(sub, "step"), null); };
export function getInterests(): Interest[] { try { return (JSON.parse(get("kx-interests") ?? "[]") as string[]).filter((x): x is Interest => (INTERESTS as readonly string[]).includes(x)); } catch { return []; } }
export const setInterests = (list: Interest[]) => set("kx-interests", JSON.stringify(list));

/** Sign-in entry bookkeeping (sessionStorage): why the visitor is at /signin and what they chose. */
export type AuthIntent = "signin" | "register";
export const INTENT_KEY = "kx-auth-intent";
export const REASON_KEY = "kx-auth-reason";
export const sget = (k: string): string | null => { try { return sessionStorage.getItem(k); } catch { return null; } };
export const sset = (k: string, v: string | null) => { try { if (v === null) sessionStorage.removeItem(k); else sessionStorage.setItem(k, v); } catch { /* ignore */ } };
