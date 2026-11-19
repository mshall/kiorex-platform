import { prefs } from "./storage";

const KEY = "kx-recent-doctors";
const MAX = 8;
/** Public doctor listing data only (never patient data). */
export interface RecentDoctor { id: string; nameAr: string; nameEn: string; specialty: string }

export const pushRecent = (items: RecentDoctor[], d: RecentDoctor) => [d, ...items.filter((x) => x.id !== d.id)].slice(0, MAX);

export async function getRecent(): Promise<RecentDoctor[]> {
  try { return JSON.parse((await prefs.get(KEY)) ?? "[]") as RecentDoctor[]; } catch { return []; }
}
export async function addRecent(d: RecentDoctor) { await prefs.set(KEY, JSON.stringify(pushRecent(await getRecent(), d))); }
