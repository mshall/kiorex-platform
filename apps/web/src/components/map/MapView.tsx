import type { Point } from "geojson";
import "maplibre-gl/dist/maplibre-gl.css";
import { useCallback, useEffect, useLayoutEffect, useRef, useState, type ReactNode } from "react";
import { useTranslation } from "react-i18next";
import { LocateFixed, Loader2 } from "lucide-react";
import type { GeoJSONSource, Map as MlMap, Marker as MlMarker } from "maplibre-gl";
import { cn } from "@/lib/utils";
import { resolveMapConfig, type MapConfig } from "@/lib/map/config";
import { boundsOf, toGeoJSON, type MapPoint } from "@/lib/map/points";

export interface MapViewProps {
  points: MapPoint[];
  selectedId?: string | null;
  onSelect?: (id: string | null) => void;
  /** Show the "near me" control; called with the patient's position once the browser grants it. */
  onLocate?: (pos: { lat: number; lng: number }) => void;
  className?: string;
  label: string;
  /** Shown instead of the map when WebGL is unavailable or the map failed to start. */
  fallback?: ReactNode;
  config?: MapConfig;
}

type Geo = "idle" | "locating" | "denied" | "unsupported" | "unavailable";
const INDIGO = "#3730A3", CORAL = "#E8735E", OCEAN = "#0369A1";
const SRC = "kx-points";

export const webglAvailable = (): boolean => {
  try { const c = document.createElement("canvas"); return !!(c.getContext("webgl2") || c.getContext("webgl")); } catch { return false; }
};

/**
 * Interactive map (MapLibre GL): clinic markers, native GeoJSON clustering (cluster bubbles are real buttons so they are keyboard and
 * screen-reader reachable), selection, "near me" via the browser Geolocation API, and RTL-safe chrome (zoom control and near-me button
 * flip to the logical end side; labels use the RTL text plugin when the style provides one). Loaded lazily by its callers.
 */
export default function MapView({ points, selectedId, onSelect, onLocate, className, label, fallback, config }: MapViewProps) {
  const { t, i18n } = useTranslation();
  const rtl = i18n.dir() === "rtl";
  const host = useRef<HTMLDivElement>(null);
  const mapRef = useRef<MlMap | null>(null);
  const lib = useRef<typeof import("maplibre-gl") | null>(null);
  const clusterMarkers = useRef<Map<number, MlMarker>>(new Map());
  const userMarker = useRef<MlMarker | null>(null);
  const [ready, setReady] = useState(false);
  const [noWebgl] = useState(() => !webglAvailable());
  const [startFailed, setFailed] = useState(false);
  const failed = noWebgl || startFailed;
  const [geo, setGeo] = useState<Geo>("idle");
  const latest = useRef({ points, selectedId, onSelect, t });
  useLayoutEffect(() => { latest.current = { points, selectedId, onSelect, t }; });
  const cfg = useRef<MapConfig>(config ?? resolveMapConfig());
  const located = useRef(false);

  /** Cluster bubbles as DOM markers (no glyph server needed offline); rebuilt from the clusters currently on screen. */
  const syncClusters = useCallback(() => {
    const map = mapRef.current, ml = lib.current;
    if (!map || !ml || !map.getSource(SRC) || !map.isSourceLoaded(SRC)) return;
    const seen = new Set<number>();
    for (const f of map.querySourceFeatures(SRC, { filter: ["has", "point_count"] })) {
      const p = f.properties as { cluster_id: number; point_count: number };
      if (seen.has(p.cluster_id)) continue;
      seen.add(p.cluster_id);
      if (clusterMarkers.current.has(p.cluster_id)) continue;
      const el = document.createElement("button");
      el.type = "button";
      el.dataset.testid = "map-cluster";
      el.setAttribute("data-testid", "map-cluster");
      el.setAttribute("aria-label", latest.current.t("map.cluster", { count: p.point_count }));
      const size = p.point_count < 10 ? 36 : p.point_count < 50 ? 44 : 52;
      el.style.cssText = `width:${size}px;height:${size}px;border-radius:9999px;background:${INDIGO};color:#fff;border:3px solid ${CORAL};font:600 13px/1 system-ui,sans-serif;cursor:pointer;box-shadow:0 2px 8px rgba(55,48,163,.35);font-variant-numeric:tabular-nums`;
      el.textContent = new Intl.NumberFormat(document.documentElement.lang === "ar" ? "ar-EG" : "en").format(p.point_count);
      const coords = (f.geometry as Point).coordinates as [number, number];
      el.addEventListener("click", () => {
        const src = map.getSource(SRC) as GeoJSONSource;
        void src.getClusterExpansionZoom(p.cluster_id).then((zoom) => map.easeTo({ center: coords, zoom: Math.min(zoom, 17) })).catch(() => undefined);
      });
      clusterMarkers.current.set(p.cluster_id, new ml.Marker({ element: el }).setLngLat(coords).addTo(map));
    }
    for (const [id, m] of clusterMarkers.current) if (!seen.has(id)) { m.remove(); clusterMarkers.current.delete(id); }
  }, []);

  // -------------------------------------------------------------- create / destroy
  useEffect(() => {
    let cancelled = false;
    if (noWebgl) return;
    void (async () => {
      try {
        const ml = await import("maplibre-gl");
        if (cancelled || !host.current) return;
        lib.current = ml;
        const c = cfg.current;
        if (c.rtlTextPluginUrl && ml.getRTLTextPluginStatus() === "unavailable") void ml.setRTLTextPlugin(c.rtlTextPluginUrl, true);
        const first = latest.current.points;
        const map = new ml.Map({
          container: host.current, style: c.style, center: first[0] ? [first[0].lng, first[0].lat] : c.defaultCenter, zoom: first.length === 1 ? 15 : 10,
          attributionControl: false, cooperativeGestures: true, dragRotate: false, pitchWithRotate: false, maxZoom: 18,
        });
        map.touchZoomRotate.disableRotation();
        map.addControl(new ml.AttributionControl({ compact: true, customAttribution: c.provider === "osm" ? c.attribution : undefined }), rtl ? "bottom-left" : "bottom-right");
        map.addControl(new ml.NavigationControl({ showCompass: false }), rtl ? "top-left" : "top-right");
        mapRef.current = map;
        map.on("load", () => {
          map.addSource(SRC, { type: "geojson", data: toGeoJSON(latest.current.points), cluster: true, clusterMaxZoom: 14, clusterRadius: 48 });
          map.addLayer({ id: "kx-point-halo", type: "circle", source: SRC, filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 13, "circle-color": "#ffffff", "circle-opacity": 0.9 } });
          map.addLayer({ id: "kx-point", type: "circle", source: SRC, filter: ["!", ["has", "point_count"]], paint: { "circle-radius": 8, "circle-color": CORAL, "circle-stroke-width": 2.5, "circle-stroke-color": INDIGO } });
          map.addLayer({ id: "kx-point-selected", type: "circle", source: SRC, filter: ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], latest.current.selectedId ?? ""]], paint: { "circle-radius": 11, "circle-color": INDIGO, "circle-stroke-width": 3.5, "circle-stroke-color": CORAL } });
          map.on("click", "kx-point", (e) => { const id = e.features?.[0]?.properties?.id as string | undefined; if (id) latest.current.onSelect?.(id); });
          map.on("mouseenter", "kx-point", () => { map.getCanvas().style.cursor = "pointer"; });
          map.on("mouseleave", "kx-point", () => { map.getCanvas().style.cursor = ""; });
          map.on("click", (e) => { if (!map.queryRenderedFeatures(e.point, { layers: ["kx-point"] }).length) latest.current.onSelect?.(null); });
          map.on("moveend", () => syncClusters());
          map.on("idle", () => syncClusters());
          map.on("sourcedata", (e) => { if (e.sourceId === SRC && e.isSourceLoaded) syncClusters(); });
          setReady(true);
        });
        map.on("error", () => { /* tile/style hiccups must never take the page down */ });
      } catch { if (!cancelled) setFailed(true); }
    })();
    const markers = clusterMarkers.current;
    return () => {
      cancelled = true;
      for (const m of markers.values()) m.remove();
      markers.clear();
      userMarker.current?.remove(); userMarker.current = null;
      mapRef.current?.remove(); mapRef.current = null; setReady(false);
    };
    // the map is created once; later prop changes are applied by the effects below
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // -------------------------------------------------------------- data / selection
  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map) return;
    (map.getSource(SRC) as GeoJSONSource | undefined)?.setData(toGeoJSON(points));
    for (const m of clusterMarkers.current.values()) m.remove();
    clusterMarkers.current.clear();
    const b = boundsOf(points);
    if (b && !located.current) {
      if (points.length === 1) map.jumpTo({ center: [points[0].lng, points[0].lat], zoom: 15 });
      else map.fitBounds(b, { padding: 56, maxZoom: 15, duration: 0 });
    }
  }, [points, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!ready || !map || !map.getLayer("kx-point-selected")) return;
    map.setFilter("kx-point-selected", ["all", ["!", ["has", "point_count"]], ["==", ["get", "id"], selectedId ?? ""]]);
    const p = points.find((x) => x.id === selectedId);
    if (p) map.easeTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 13), duration: 400 });
  }, [selectedId, ready, points]);

  // -------------------------------------------------------------- near me
  const locate = () => {
    if (!("geolocation" in navigator)) return setGeo("unsupported");
    setGeo("locating");
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const p = { lat: pos.coords.latitude, lng: pos.coords.longitude };
        setGeo("idle");
        located.current = true;
        const map = mapRef.current, ml = lib.current;
        if (map && ml) {
          userMarker.current?.remove();
          const dot = document.createElement("div");
          dot.setAttribute("data-testid", "map-user-location");
          dot.setAttribute("role", "img");
          dot.setAttribute("aria-label", latest.current.t("map.you"));
          dot.style.cssText = `width:16px;height:16px;border-radius:9999px;background:${OCEAN};border:3px solid #fff;box-shadow:0 0 0 6px rgba(3,105,161,.25)`;
          userMarker.current = new ml.Marker({ element: dot }).setLngLat([p.lng, p.lat]).addTo(map);
          map.flyTo({ center: [p.lng, p.lat], zoom: Math.max(map.getZoom(), 12) });
        }
        onLocate?.(p);
      },
      (err) => setGeo(err.code === 1 ? "denied" : "unavailable"),
      { enableHighAccuracy: false, timeout: 8000, maximumAge: 60_000 },
    );
  };

  if (failed) return <div data-testid="map-fallback">{fallback}</div>;
  return (
    <div className={cn("relative overflow-hidden rounded-xl border bg-accent", className)} data-testid="interactive-map">
      <div ref={host} className="absolute inset-0" role="region" aria-label={label} />
      {!ready && <div className="absolute inset-0 grid place-items-center text-muted-foreground" aria-hidden="true"><Loader2 className="h-5 w-5 animate-spin" /></div>}
      {onLocate && (
        <div className="absolute bottom-8 inset-e-3 z-10 flex flex-col items-end gap-2">
          <button type="button" onClick={locate} disabled={geo === "locating"} data-testid="near-me" className="kx-glass inline-flex min-h-11 items-center gap-2 rounded-full px-4 text-sm font-semibold shadow-md hover:bg-accent disabled:opacity-70">
            {geo === "locating" ? <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" /> : <LocateFixed className="h-4 w-4 text-ocean" aria-hidden="true" />}{t("map.nearMe")}
          </button>
        </div>
      )}
      <p className="sr-only" role="status" aria-live="polite" data-testid="map-geo-status">{geo === "denied" ? t("map.denied") : geo === "unsupported" ? t("map.unsupported") : geo === "unavailable" ? t("map.unavailable") : geo === "locating" ? t("map.locating") : ""}</p>
      {(geo === "denied" || geo === "unsupported" || geo === "unavailable") && (
        <p className="absolute inset-s-3 top-3 z-10 max-w-[70%] rounded-lg border border-warning/50 bg-warning-soft px-3 py-2 text-xs text-warning" aria-hidden="true">{geo === "denied" ? t("map.denied") : geo === "unsupported" ? t("map.unsupported") : t("map.unavailable")}</p>
      )}
    </div>
  );
}
