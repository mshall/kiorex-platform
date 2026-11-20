import type { Feature } from "geojson";
import type { StyleSpecification } from "maplibre-gl";

/**
 * Map configuration (KXMDS05). Provider-neutral: the app renders with MapLibre GL and only needs a style. Choose it through env:
 *   VITE_MAP_PROVIDER = mock (default) | osm | style | amazon
 *   mock    offline-safe style (background + graticule, no network, no key). Dev/test/CI default (CLAUDE.md: providers are MOCKED).
 *   osm     OSM-style raster tiles from VITE_MAP_TILES_URL (default: the public OSM tile server, dev only; production must use a
 *           tile provider whose usage policy allows the traffic) with the attribution below.
 *   style   any MapLibre style JSON URL in VITE_MAP_STYLE_URL (self-hosted / MapTiler / Protomaps ...).
 *   amazon  optional adapter for an Amazon Location map: VITE_AMAZON_LOCATION_STYLE_URL = the style descriptor URL (Amazon Location
 *           Service map style API incl. the browser-restricted API key, e.g. https://maps.geo.<region>.amazonaws.com/v2/styles/<name>/descriptor?key=...).
 *           No AWS SDK in the browser: the key is a restricted public key created in the "Provider go-live" pass (Docs/NEEDS_HUMAN.md).
 * Any missing value for a real provider falls back to `mock`, so a half-configured build never shows a broken map.
 */
export type MapProvider = "mock" | "osm" | "style" | "amazon";
export type MapEnv = Partial<Record<
  "VITE_MAP_PROVIDER" | "VITE_MAP_STYLE_URL" | "VITE_MAP_TILES_URL" | "VITE_MAP_ATTRIBUTION" | "VITE_AMAZON_LOCATION_STYLE_URL" | "VITE_MAP_RTL_TEXT_PLUGIN_URL" | "VITE_MAP_DEFAULT_CENTER",
  string | undefined
>>;

export interface MapConfig {
  provider: MapProvider;
  style: StyleSpecification | string;
  attribution: string;
  rtlTextPluginUrl?: string;
  defaultCenter: [number, number]; // [lng, lat]
}

export const OSM_ATTRIBUTION = "© OpenStreetMap contributors";
const CAIRO: [number, number] = [31.2357, 30.0444];

/** Offline-safe style: flat ground colour plus a graticule drawn from inline GeoJSON. Needs no network request at all. */
export function mockStyle(): StyleSpecification {
  // graticule limited to the launch window (Egypt/MENA) at 0.1 degree steps: light enough to inline, enough to show pan/zoom
  const win: Feature[] = [];
  for (let lng = 24; lng <= 38; lng += 0.1) win.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[Number(lng.toFixed(2)), 21], [Number(lng.toFixed(2)), 33]] } });
  for (let lat = 21; lat <= 33; lat += 0.1) win.push({ type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: [[24, Number(lat.toFixed(2))], [38, Number(lat.toFixed(2))]] } });
  return {
    version: 8,
    name: "kiorex-mock",
    sources: { graticule: { type: "geojson", data: { type: "FeatureCollection", features: win } } },
    layers: [
      { id: "ground", type: "background", paint: { "background-color": "#eef1fa" } },
      { id: "graticule", type: "line", source: "graticule", paint: { "line-color": "#c9d0ea", "line-width": 1, "line-opacity": 0.8 } },
    ],
  };
}

export function osmStyle(tilesUrl: string, attribution: string): StyleSpecification {
  return {
    version: 8,
    name: "kiorex-osm-raster",
    sources: { osm: { type: "raster", tiles: [tilesUrl], tileSize: 256, maxzoom: 19, attribution } },
    layers: [{ id: "osm", type: "raster", source: "osm" }],
  };
}

const isUrl = (v?: string) => !!v && /^https?:\/\//i.test(v);

export function resolveMapConfig(env: MapEnv = (import.meta as unknown as { env: MapEnv }).env): MapConfig {
  const attribution = env.VITE_MAP_ATTRIBUTION?.trim() || OSM_ATTRIBUTION;
  const rtl = isUrl(env.VITE_MAP_RTL_TEXT_PLUGIN_URL) ? env.VITE_MAP_RTL_TEXT_PLUGIN_URL : undefined;
  let defaultCenter = CAIRO;
  const c = env.VITE_MAP_DEFAULT_CENTER?.split(",").map(Number);
  if (c && c.length === 2 && c.every(Number.isFinite) && Math.abs(c[1]) <= 90 && Math.abs(c[0]) <= 180) defaultCenter = [c[0], c[1]];
  const base = { attribution, rtlTextPluginUrl: rtl, defaultCenter };
  const want = (env.VITE_MAP_PROVIDER ?? "mock").toLowerCase();
  if (want === "osm") return { ...base, provider: "osm", style: osmStyle(env.VITE_MAP_TILES_URL?.includes("{z}") ? env.VITE_MAP_TILES_URL : "https://tile.openstreetmap.org/{z}/{x}/{y}.png", attribution) };
  if (want === "style" && isUrl(env.VITE_MAP_STYLE_URL)) return { ...base, provider: "style", style: env.VITE_MAP_STYLE_URL! };
  if (want === "amazon" && isUrl(env.VITE_AMAZON_LOCATION_STYLE_URL)) return { ...base, provider: "amazon", style: env.VITE_AMAZON_LOCATION_STYLE_URL! };
  return { ...base, provider: "mock", style: mockStyle() };
}
