import { prefs } from "./storage";

/**
 * Growth (attribution) consent held on the device until the consent package (GRW-P1-I) provides the central store. Three states: granted, denied,
 * undecided (null). Nothing leaves the device for attribution unless this is "granted". The wording shown next to the choice is a draft
 * (NEEDS_HUMAN: counsel) and the choice is equal-weight (Allow / Not now).
 */
const KEY = "kx.consent.growth.v1";
export type GrowthConsent = "granted" | "denied" | null;
let reader: () => Promise<GrowthConsent> = async () => { const v = await prefs.get(KEY); return v === "granted" || v === "denied" ? v : null; };
/** The consent package replaces the reader with its own source of truth. */
export function setGrowthConsentReader(fn: () => Promise<GrowthConsent>) { reader = fn; }
export const getGrowthConsent = (): Promise<GrowthConsent> => reader();
export async function setGrowthConsent(v: "granted" | "denied") { await prefs.set(KEY, v); }
