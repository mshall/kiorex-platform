import type { Clinic, DoctorSummary } from "@/api/types";

/** One marker on the map: a clinic location (several providers can share a clinic and therefore a coordinate). */
export interface MapPoint { id: string; lng: number; lat: number; title: string; subtitle?: string; href?: string }

export const validCoord = (lat: unknown, lng: unknown): lat is number =>
  typeof lat === "number" && typeof lng === "number" && Number.isFinite(lat) && Number.isFinite(lng) && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);

export function pointsFromDoctors(items: DoctorSummary[], lang: string): MapPoint[] {
  const out: MapPoint[] = [];
  for (const d of items) {
    if (!validCoord(d.latitude, d.longitude)) continue;
    const ar = lang.startsWith("ar");
    out.push({ id: d.id, lng: d.longitude as number, lat: d.latitude as number, title: ar ? d.nameAr : d.nameEn, subtitle: ar ? d.clinicNameAr : d.clinicNameEn, href: `/doctors/${d.id}` });
  }
  return out;
}

export function pointFromClinic(c: Clinic, lang: string): MapPoint | undefined {
  if (!validCoord(c.lat, c.lng)) return undefined;
  const ar = lang.startsWith("ar");
  return { id: c.id || "clinic", lng: c.lng as number, lat: c.lat as number, title: ar ? c.nameAr : c.nameEn, subtitle: ar ? c.addressAr : c.addressEn };
}

export function toGeoJSON(points: MapPoint[]): GeoJSON.FeatureCollection<GeoJSON.Point> {
  return { type: "FeatureCollection", features: points.map((p) => ({ type: "Feature", id: undefined, properties: { id: p.id }, geometry: { type: "Point", coordinates: [p.lng, p.lat] } })) };
}

export function boundsOf(points: Array<{ lng: number; lat: number }>): [[number, number], [number, number]] | undefined {
  if (!points.length) return undefined;
  let w = 180, s = 90, e = -180, n = -90;
  for (const p of points) { w = Math.min(w, p.lng); e = Math.max(e, p.lng); s = Math.min(s, p.lat); n = Math.max(n, p.lat); }
  return [[w, s], [e, n]];
}

/** Haversine distance in km (used for the "near me" label when the API did not return one). */
export function distanceKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const r = Math.PI / 180, dLat = (b.lat - a.lat) * r, dLng = (b.lng - a.lng) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLng / 2) ** 2;
  return 6371 * 2 * Math.asin(Math.min(1, Math.sqrt(h)));
}
