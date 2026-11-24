import { beforeEach, describe, expect, it, vi } from "vitest";
import { CONTROL, loadAssignments, recordExposure, resetExperimentCache, variantOf, type ExperimentDeps } from "./experiments";

const deps = (o: Partial<ExperimentDeps> = {}): ExperimentDeps => ({ fetch: vi.fn(async () => new Response(JSON.stringify({ assignments: [{ experiment: "home-hero-1", surface: "landing.home.hero_copy", variant: "b", flagKey: null }] }), { status: 200 })) as unknown as typeof fetch, now: () => 1_000, consent: () => true, ...o });

describe("experiments client (GRW-P3-A)", () => {
  beforeEach(() => { resetExperimentCache(); localStorage.clear(); });
  it("without analytics consent nothing is requested and everything is the control", async () => {
    const d = deps({ consent: () => false });
    expect(await loadAssignments("landing.home.hero_copy", "ar", d)).toEqual([]); expect(d.fetch).not.toHaveBeenCalled();
    expect(await recordExposure("home-hero-1", d)).toBe(false); expect(d.fetch).not.toHaveBeenCalled();
    expect(variantOf([], "home-hero-1")).toBe(CONTROL);
  });
  it("with consent it asks once per surface for 10 minutes and returns the server's variant", async () => {
    let t = 1_000; const d = deps({ now: () => t });
    const a = await loadAssignments("landing.home.hero_copy", "en", d); expect(variantOf(a, "home-hero-1")).toBe("b");
    await loadAssignments("landing.home.hero_copy", "en", d); expect(d.fetch).toHaveBeenCalledTimes(1);
    t += 11 * 60_000; await loadAssignments("landing.home.hero_copy", "en", d); expect(d.fetch).toHaveBeenCalledTimes(2);
    expect(String((d.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![0])).toContain("surface=landing.home.hero_copy");
  });
  it("a failed call, a non-OK answer or garbage is the control, never an exception", async () => {
    expect(await loadAssignments("a.b", undefined, deps({ fetch: vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch }))).toEqual([]);
    resetExperimentCache(); expect(await loadAssignments("a.b", undefined, deps({ fetch: vi.fn(async () => new Response("nope", { status: 503 })) as unknown as typeof fetch }))).toEqual([]);
    resetExperimentCache(); expect(await loadAssignments("a.b", undefined, deps({ fetch: vi.fn(async () => new Response(JSON.stringify({ assignments: [{ nope: 1 }, "x"] }), { status: 200 })) as unknown as typeof fetch }))).toEqual([]);
    expect(await recordExposure("x-1", deps({ fetch: vi.fn(async () => { throw new Error("offline"); }) as unknown as typeof fetch }))).toBe(false);
  });
  it("an exposure is sent once per experiment per page session and carries no variant, only the experiment key", async () => {
    const d = deps({ fetch: vi.fn(async () => new Response("{}", { status: 200 })) as unknown as typeof fetch });
    expect(await recordExposure("home-hero-1", d)).toBe(true); expect(await recordExposure("home-hero-1", d)).toBe(false);
    const body = (d.fetch as ReturnType<typeof vi.fn>).mock.calls[0]![1].body as string; expect(JSON.parse(body)).toEqual({ experiment: "home-hero-1" });
  });
});
