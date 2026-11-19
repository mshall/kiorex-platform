// "Recently viewed doctors" lives on-device only (localStorage). Public doctor info only — no health data.
export interface RecentDoctor { id: string; nameAr: string; nameEn: string; specialtyCode: string }
const KEY = "kx-recent-doctors";

export function getRecent(): RecentDoctor[] {
  try { return JSON.parse(localStorage.getItem(KEY) ?? "[]") as RecentDoctor[]; } catch { return []; }
}
export function pushRecent(d: RecentDoctor) {
  try { localStorage.setItem(KEY, JSON.stringify([d, ...getRecent().filter((x) => x.id !== d.id)].slice(0, 6))); } catch { /* ignore */ }
}
