import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { useTheme } from "@/hooks/useTheme";
import fs from "node:fs";
import path from "node:path";

/** Founder, 24 Nov 2026: LIGHT is the default theme; only an explicit toggle is stored (`kx-theme`) and restored. */
const reset = () => { document.documentElement.classList.remove("dark"); localStorage.clear(); };
beforeEach(reset); afterEach(reset);

describe("theme: light by default, explicit choice persisted", () => {
  it("is light on a fresh visit and stores nothing", () => {
    const { result } = renderHook(() => useTheme());
    expect(result.current.theme).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
    expect(localStorage.getItem("kx-theme")).toBeNull();
  });
  it("toggling to dark applies the class and persists; a reload (new hook, class from the boot script) restores it", () => {
    const { result } = renderHook(() => useTheme());
    act(() => result.current.toggle());
    expect(result.current.theme).toBe("dark");
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("kx-theme")).toBe("dark");
    const again = renderHook(() => useTheme()); // index.html's inline script left the class on <html>
    expect(again.result.current.theme).toBe("dark");
    act(() => again.result.current.toggle());
    expect(localStorage.getItem("kx-theme")).toBe("light");
    expect(document.documentElement.classList.contains("dark")).toBe(false);
  });
  it("the inline boot script in index.html applies dark only for a stored dark choice, never from the OS setting", () => {
    const html = fs.readFileSync(path.resolve(__dirname, "../../index.html"), "utf8");
    expect(html).not.toMatch(/prefers-color-scheme/);
    const script = html.match(/<script>\s*(try \{[\s\S]*?)<\/script>/)![1]!;
    const run = (stored: string | null) => {
      document.documentElement.classList.remove("dark");
      new Function("localStorage", "matchMedia", "document", script)({ getItem: (k: string) => (k === "kx-theme" ? stored : null) }, () => ({ matches: true }), document);
      return document.documentElement.classList.contains("dark");
    };
    expect(run(null)).toBe(false); expect(run("light")).toBe(false); expect(run("dark")).toBe(true);
  });
});
