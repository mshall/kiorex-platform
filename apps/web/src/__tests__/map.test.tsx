import { act, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

// MapLibre needs WebGL, which jsdom does not have: the real library is replaced by a recording fake so the component logic is exercised.
const ml = vi.hoisted(() => {
  const state = { maps: [] as any[], markers: [] as any[], controls: [] as Array<{ kind: string; pos: string }>, clusters: [] as any[], rtlPlugin: [] as string[] }; // eslint-disable-line @typescript-eslint/no-explicit-any
  class FakeMap {
    handlers: Record<string, Array<(e?: any) => void>> = {}; sources: Record<string, any> = {}; layers: Record<string, any> = {}; calls: Array<[string, unknown?]> = []; // eslint-disable-line @typescript-eslint/no-explicit-any
    touchZoomRotate = { disableRotation() {} };
    constructor(public opts: any) { state.maps.push(this); queueMicrotask(() => this.fire("load")); } // eslint-disable-line @typescript-eslint/no-explicit-any
    on(ev: string, a: any, b?: any) { const key = typeof a === "string" ? `${ev}:${a}` : ev; (this.handlers[key] ??= []).push(typeof a === "string" ? b : a); } // eslint-disable-line @typescript-eslint/no-explicit-any
    fire(ev: string, e?: unknown) { for (const h of this.handlers[ev] ?? []) h(e); }
    addControl(c: { kind: string }, pos: string) { state.controls.push({ kind: c.kind, pos }); }
    addSource(id: string, s: any) { this.sources[id] = { ...s, setData: (d: unknown) => this.calls.push(["setData", d]), getClusterExpansionZoom: async () => 13 }; } // eslint-disable-line @typescript-eslint/no-explicit-any
    getSource(id: string) { return this.sources[id]; }
    addLayer(l: any) { this.layers[l.id] = l; } // eslint-disable-line @typescript-eslint/no-explicit-any
    getLayer(id: string) { return this.layers[id]; }
    setFilter(id: string, f: unknown) { this.calls.push(["setFilter", { id, f }]); }
    isSourceLoaded() { return true; }
    querySourceFeatures() { return state.clusters; }
    queryRenderedFeatures() { return []; }
    fitBounds(b: unknown) { this.calls.push(["fitBounds", b]); }
    jumpTo(o: unknown) { this.calls.push(["jumpTo", o]); }
    easeTo(o: unknown) { this.calls.push(["easeTo", o]); }
    flyTo(o: unknown) { this.calls.push(["flyTo", o]); }
    getZoom() { return 10; }
    getCanvas() { return { style: {} as Record<string, string> }; }
    remove() { this.calls.push(["remove"]); }
  }
  class FakeMarker { lngLat: unknown; constructor(public o: { element: HTMLElement }) { state.markers.push(this); } setLngLat(p: unknown) { this.lngLat = p; return this; } addTo(m: { calls: unknown[] }) { m.calls.push(["marker", this.o.element.getAttribute("data-testid")]); document.body.appendChild(this.o.element); return this; } remove() { this.o.element.remove(); } }
  return {
    state,
    mod: {
      Map: FakeMap, Marker: FakeMarker,
      NavigationControl: class { kind = "nav"; }, AttributionControl: class { kind = "attribution"; constructor(public o: unknown) {} },
      getRTLTextPluginStatus: () => "unavailable", setRTLTextPlugin: async (u: string) => { state.rtlPlugin.push(u); },
    },
  };
});
vi.mock("maplibre-gl", () => ml.mod);
vi.mock("maplibre-gl/dist/maplibre-gl.css", () => ({}));

import { renderApp } from "@/test/utils";
import MapView from "@/components/map/MapView";
import { ResultsMap } from "@/components/map/ResultsMap";
import { ClinicMap } from "@/components/ClinicMap";
import { mockStyle, osmStyle, resolveMapConfig } from "@/lib/map/config";
import { boundsOf, distanceKm, pointFromClinic, pointsFromDoctors, toGeoJSON, validCoord } from "@/lib/map/points";
import { parseSearch, toQuery } from "@/lib/searchParams";
import { seeds, summaryFor } from "@/test/mocks/data";
import { mapSearchItem } from "@/api/adapters";

const doctors = (n = 3) => seeds.slice(0, n).map((s, i) => ({ ...summaryFor(s), latitude: 30.04 + i * 0.01, longitude: 31.23 + i * 0.01 }));

describe("map config (provider-neutral, offline-safe)", () => {
  it("defaults to the mock style with no network sources", () => {
    const c = resolveMapConfig({});
    expect(c.provider).toBe("mock");
    const style = c.style as ReturnType<typeof mockStyle>;
    expect(style.layers.map((l) => l.id)).toEqual(["ground", "graticule"]);
    expect(JSON.stringify(style)).not.toMatch(/https?:\/\//);
    expect(Object.values(style.sources).every((s) => s.type === "geojson")).toBe(true);
  });
  it("builds OSM raster tiles with attribution and rejects a template without {z}", () => {
    const c = resolveMapConfig({ VITE_MAP_PROVIDER: "osm", VITE_MAP_TILES_URL: "https://tiles.example/{z}/{x}/{y}.png" });
    expect(c.provider).toBe("osm");
    expect(JSON.stringify(c.style)).toContain("https://tiles.example/{z}/{x}/{y}.png");
    expect(JSON.stringify(osmStyle("https://t/{z}/{x}/{y}.png", "© OSM"))).toContain("© OSM");
    expect(JSON.stringify(resolveMapConfig({ VITE_MAP_PROVIDER: "osm", VITE_MAP_TILES_URL: "https://bad" }).style)).toContain("tile.openstreetmap.org");
  });
  it("supports a style URL and the optional Amazon Location adapter, falling back to mock when misconfigured", () => {
    expect(resolveMapConfig({ VITE_MAP_PROVIDER: "style", VITE_MAP_STYLE_URL: "https://maps.example/style.json" })).toMatchObject({ provider: "style", style: "https://maps.example/style.json" });
    expect(resolveMapConfig({ VITE_MAP_PROVIDER: "amazon", VITE_AMAZON_LOCATION_STYLE_URL: "https://maps.geo.eu-central-1.amazonaws.com/v2/styles/Standard/descriptor?key=k" }).provider).toBe("amazon");
    expect(resolveMapConfig({ VITE_MAP_PROVIDER: "amazon" }).provider).toBe("mock");
    expect(resolveMapConfig({ VITE_MAP_PROVIDER: "style", VITE_MAP_STYLE_URL: "javascript:alert(1)" }).provider).toBe("mock");
  });
  it("parses the default centre and the optional RTL text plugin URL", () => {
    expect(resolveMapConfig({ VITE_MAP_DEFAULT_CENTER: "46.7,24.7" }).defaultCenter).toEqual([46.7, 24.7]);
    expect(resolveMapConfig({ VITE_MAP_DEFAULT_CENTER: "999,1" }).defaultCenter).toEqual([31.2357, 30.0444]);
    expect(resolveMapConfig({ VITE_MAP_RTL_TEXT_PLUGIN_URL: "https://cdn.example/rtl.js" }).rtlTextPluginUrl).toBe("https://cdn.example/rtl.js");
    expect(resolveMapConfig({ VITE_MAP_RTL_TEXT_PLUGIN_URL: "data:evil" }).rtlTextPluginUrl).toBeUndefined();
  });
});

describe("map points", () => {
  it("keeps only providers with valid coordinates and localises the title", () => {
    const d = [...doctors(2), { ...summaryFor(seeds[2]), latitude: null, longitude: null }, { ...summaryFor(seeds[3]), latitude: 0, longitude: 0 }];
    const ar = pointsFromDoctors(d, "ar"); const en = pointsFromDoctors(d, "en");
    expect(ar).toHaveLength(2); expect(en[0].title).toBe(d[0].nameEn); expect(ar[0].title).toBe(d[0].nameAr);
    expect(ar[0].href).toBe(`/doctors/${d[0].id}`);
  });
  it("validates coordinates, builds GeoJSON, bounds and distance", () => {
    expect(validCoord(30, 31)).toBe(true); expect(validCoord(95, 0)).toBe(false); expect(validCoord(NaN, 1)).toBe(false); expect(validCoord(null, 1)).toBe(false);
    const pts = pointsFromDoctors(doctors(), "en");
    expect(toGeoJSON(pts).features[0].geometry.coordinates).toEqual([31.23, 30.04]);
    expect(boundsOf(pts)).toEqual([[31.23, 30.04], [31.25, 30.06]]); expect(boundsOf([])).toBeUndefined();
    expect(distanceKm({ lat: 30.0444, lng: 31.2357 }, { lat: 31.2001, lng: 29.9187 })).toBeGreaterThan(170);
    expect(pointFromClinic({ id: "c", nameAr: "ع", nameEn: "E", addressAr: "", addressEn: "", lat: null, lng: null } as never, "en")).toBeUndefined();
  });
  it("adapter exposes API latitude/longitude; search params round-trip lat/lng for near me", () => {
    expect(mapSearchItem({ id: "p", latitude: 30.1, longitude: 31.2 }).latitude).toBe(30.1);
    expect(mapSearchItem({ id: "p" }).longitude).toBeNull();
    const q = toQuery({ sort: "distance", lat: 30.04, lng: 31.23 });
    expect(q.get("lat")).toBe("30.04");
    expect(parseSearch(q)).toMatchObject({ lat: 30.04, lng: 31.23, sort: "distance" });
  });
});

describe("MapView", () => {
  beforeEach(() => {
    ml.state.maps.length = 0; ml.state.markers.length = 0; ml.state.controls.length = 0; ml.state.clusters.length = 0; ml.state.rtlPlugin.length = 0;
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never);
  });
  afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, "geolocation"); });

  const mapOf = async () => { await waitFor(() => expect(ml.state.maps.length).toBe(1)); await waitFor(() => expect(ml.state.maps[0].layers["kx-point"]).toBeTruthy()); return ml.state.maps[0]; };

  it("creates a clustered GeoJSON source, point layers and fits the bounds", async () => {
    const pts = pointsFromDoctors(doctors(), "en");
    renderApp(<MapView points={pts} label="Map" />, { lang: "en" });
    const m = await mapOf();
    expect(m.sources["kx-points"]).toMatchObject({ type: "geojson", cluster: true });
    expect(Object.keys(m.layers)).toEqual(expect.arrayContaining(["kx-point", "kx-point-halo", "kx-point-selected"]));
    expect(m.opts.attributionControl).toBe(false);
    await waitFor(() => expect(m.calls.some((c: [string]) => c[0] === "fitBounds")).toBe(true));
    expect(screen.getByRole("region", { name: "Map" })).toBeInTheDocument();
  });

  it("puts the zoom control on the logical end side: top-right in LTR, top-left in RTL", async () => {
    const { unmount } = renderApp(<MapView points={[]} label="Map" />, { lang: "en" });
    await mapOf();
    expect(ml.state.controls.find((c) => c.kind === "nav")?.pos).toBe("top-right");
    unmount(); ml.state.maps.length = 0; ml.state.controls.length = 0;
    renderApp(<MapView points={[]} label="خريطة" />, { lang: "ar" });
    await mapOf();
    expect(ml.state.controls.find((c) => c.kind === "nav")?.pos).toBe("top-left");
  });

  it("renders cluster bubbles as accessible buttons and zooms into a cluster on click", async () => {
    ml.state.clusters.push({ properties: { cluster_id: 7, point_count: 12 }, geometry: { type: "Point", coordinates: [31.2, 30.0] } });
    renderApp(<MapView points={pointsFromDoctors(doctors(), "en")} label="Map" />, { lang: "en" });
    const m = await mapOf();
    act(() => m.fire("idle"));
    const btn = await screen.findByTestId("map-cluster");
    expect(btn).toHaveAccessibleName("12 clinics here, zoom in");
    await userEvent.click(btn);
    await waitFor(() => expect(m.calls.some((c: [string, { zoom?: number }]) => c[0] === "easeTo" && c[1].zoom === 13)).toBe(true));
    ml.state.clusters.length = 0; act(() => m.fire("idle"));
    await waitFor(() => expect(screen.queryByTestId("map-cluster")).toBeNull());
  });

  it("selects a provider when a marker is clicked and clears on map click", async () => {
    const onSelect = vi.fn();
    renderApp(<MapView points={pointsFromDoctors(doctors(), "en")} onSelect={onSelect} label="Map" />, { lang: "en" });
    const m = await mapOf();
    act(() => m.fire("click:kx-point", { features: [{ properties: { id: "dr_1" } }] }));
    expect(onSelect).toHaveBeenCalledWith("dr_1");
    act(() => m.fire("click", { point: { x: 1, y: 1 } }));
    expect(onSelect).toHaveBeenLastCalledWith(null);
  });

  it("near me: asks the browser, drops a user marker, flies there and reports the position", async () => {
    const onLocate = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 30.05, longitude: 31.25 } }) } });
    renderApp(<MapView points={pointsFromDoctors(doctors(), "en")} onLocate={onLocate} label="Map" />, { lang: "en" });
    const m = await mapOf();
    await userEvent.click(screen.getByTestId("near-me"));
    expect(onLocate).toHaveBeenCalledWith({ lat: 30.05, lng: 31.25 });
    expect(m.calls.some((c: [string, { center?: number[] }]) => c[0] === "flyTo" && c[1].center?.[0] === 31.25)).toBe(true);
    expect(screen.getByTestId("map-user-location")).toHaveAccessibleName("Your location");
  });

  it.each([[1, "Location permission was declined"], [2, "We could not get your location"]])("near me error code %i is announced and nothing is reported", async (code, text) => {
    const onLocate = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (_ok: unknown, err: (e: { code: number }) => void) => err({ code }) } });
    renderApp(<MapView points={[]} onLocate={onLocate} label="Map" />, { lang: "en" });
    await mapOf();
    await userEvent.click(screen.getByTestId("near-me"));
    await waitFor(() => expect(screen.getByTestId("map-geo-status")).toHaveTextContent(text));
    expect(onLocate).not.toHaveBeenCalled();
  });

  it("falls back (no map, no crash) when WebGL is unavailable", async () => {
    vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue(null);
    renderApp(<MapView points={[]} label="Map" fallback={<p>fallback content</p>} />, { lang: "en" });
    expect(await screen.findByText("fallback content")).toBeInTheDocument();
    expect(ml.state.maps).toHaveLength(0);
  });

  it("loads the RTL text plugin only when configured", async () => {
    renderApp(<MapView points={[]} label="Map" config={{ ...resolveMapConfig({}), rtlTextPluginUrl: "https://cdn.example/rtl.js" }} />, { lang: "ar" });
    await mapOf();
    expect(ml.state.rtlPlugin).toEqual(["https://cdn.example/rtl.js"]);
  });

  it("destroys the map on unmount", async () => {
    const { unmount } = renderApp(<MapView points={[]} label="Map" />, { lang: "en" });
    const m = await mapOf();
    unmount();
    expect(m.calls.some((c: [string]) => c[0] === "remove")).toBe(true);
  });
});

describe("ResultsMap and ClinicMap", () => {
  beforeEach(() => { ml.state.maps.length = 0; ml.state.clusters.length = 0; vi.spyOn(HTMLCanvasElement.prototype, "getContext").mockReturnValue({} as never); });
  afterEach(() => { vi.restoreAllMocks(); Reflect.deleteProperty(navigator, "geolocation"); });

  it("shows the selected provider card with a profile link, and re-sorts by distance on near me", async () => {
    const apply = vi.fn();
    Object.defineProperty(navigator, "geolocation", { configurable: true, value: { getCurrentPosition: (ok: (p: unknown) => void) => ok({ coords: { latitude: 30.04561, longitude: 31.23789 } }) } });
    renderApp(<ResultsMap items={doctors()} params={{ sort: "earliest" }} apply={apply} />, { lang: "en" });
    await waitFor(() => expect(ml.state.maps[0]?.layers["kx-point"]).toBeTruthy());
    expect(screen.getByTestId("map-selection")).toHaveTextContent("Tap a marker");
    act(() => ml.state.maps[0].fire("click:kx-point", { features: [{ properties: { id: doctors()[1].id } }] }));
    expect(await screen.findByTestId("map-selection-link")).toHaveAttribute("href", `/doctors/${doctors()[1].id}`);
    await userEvent.click(screen.getByTestId("near-me"));
    expect(apply).toHaveBeenCalledWith({ sort: "distance", lat: 30.0456, lng: 31.2379, page: 1 });
  });

  it("tells the user when some results have no map location", async () => {
    const d = [...doctors(2), { ...summaryFor(seeds[2]), latitude: null, longitude: null }];
    renderApp(<ResultsMap items={d} params={{}} apply={() => {}} />, { lang: "en" });
    expect(await screen.findByTestId("map-missing")).toHaveTextContent("1 result has no map location");
  });

  it("ClinicMap shows an interactive map when coordinates exist, a plain address otherwise", async () => {
    const clinic = { id: "c1", nameAr: "عيادة", nameEn: "Clinic", addressAr: "القاهرة", addressEn: "Cairo", phone: "", lat: 30.05, lng: 31.34, paymentMethods: [], hoursAr: [], hoursEn: [] };
    const { unmount } = renderApp(<ClinicMap clinic={clinic} />, { lang: "en" });
    expect(await screen.findByTestId("interactive-map")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /directions/i })).toHaveAttribute("href", expect.stringContaining("30.05,31.34"));
    unmount();
    renderApp(<ClinicMap clinic={{ ...clinic, lat: null, lng: null }} />, { lang: "en" });
    expect(screen.queryByTestId("interactive-map")).toBeNull();
    expect(screen.getByTestId("clinic-map")).toHaveTextContent("Cairo");
  });
});
