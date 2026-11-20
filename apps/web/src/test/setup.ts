import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => cleanup());

if (!window.matchMedia) {
  window.matchMedia = ((q: string) => ({ matches: /min-width/.test(q), media: q, onchange: null, addEventListener() {}, removeEventListener() {}, addListener() {}, removeListener() {}, dispatchEvent: () => false })) as typeof window.matchMedia;
}

import { afterAll, beforeAll } from "vitest";
import { server } from "@/test/mocks/server";
import { resetMockState } from "@/test/mocks/handlers";
import "@/i18n";

beforeAll(() => server.listen({ onUnhandledFrame: "error" }));
afterEach(() => { server.resetHandlers(); resetMockState(); });
afterAll(() => server.close());

globalThis.ResizeObserver ??= class { observe() {} unobserve() {} disconnect() {} } as unknown as typeof ResizeObserver;

// jsdom has no canvas/WebGL: report "unsupported" quietly so map components take their fallback path (map.test.tsx stubs a context explicitly).
HTMLCanvasElement.prototype.getContext = (() => null) as typeof HTMLCanvasElement.prototype.getContext;
