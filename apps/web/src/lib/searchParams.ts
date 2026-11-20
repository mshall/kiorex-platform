import type { SearchParams } from "@/api/types";

export function parseSearch(sp: URLSearchParams): SearchParams {
  const n = (k: string) => (sp.get(k) ? Number(sp.get(k)) : undefined);
  const sort = sp.get("sort") as SearchParams["sort"] | null;
  return {
    q: sp.get("q") ?? undefined, specialty: sp.get("specialty") ?? undefined, area: sp.get("area") ?? undefined,
    gender: (sp.get("gender") as SearchParams["gender"]) ?? undefined, language: sp.get("language") ?? undefined,
    sort: sort ?? "earliest", maxFee: n("maxFee"), minRating: n("minRating"), acceptsDeposit: sp.get("acceptsDeposit") === "true" || undefined,
    availableWithinDays: n("availableWithinDays"), page: n("page") ?? 1,
    careType: (sp.get("careType") as SearchParams["careType"]) ?? undefined, serviceLocation: (sp.get("serviceLocation") as SearchParams["serviceLocation"]) ?? undefined, district: sp.get("district") ?? undefined, lat: n("lat"), lng: n("lng"),
  };
}

export function toQuery(p: SearchParams): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(p)) {
    if (v === undefined || v === "" || v === false || (k === "page" && v === 1) || (k === "sort" && v === "earliest")) continue;
    sp.set(k, String(v));
  }
  return sp;
}

export const activeFilterCount = (p: SearchParams) =>
  [p.area, p.maxFee, p.gender, p.language, p.minRating, p.acceptsDeposit, p.availableWithinDays, p.serviceLocation, p.district].filter((v) => v !== undefined && v !== "" && v !== false).length;
