import { describe, expect, it, vi } from "vitest";
import { act } from "react";
import { hydrateRoot } from "react-dom/client";
import { renderToString } from "react-dom/server";
import { createElement } from "react";
import { PublicApp } from "../PublicApp";
import { SAMPLES } from "./fixtures";

/** Server HTML must hydrate with ZERO mismatch warnings (React logs them through console.error), in both locales and for every page type. */
describe("hydration of the server-rendered public pages", () => {
  for (const locale of ["en", "ar"] as const) {
    for (const s of SAMPLES(locale)) {
      it(`${locale} ${s.type} hydrates cleanly and the search island becomes interactive`, async () => {
        const html = renderToString(createElement(PublicApp, { state: s }));
        document.body.innerHTML = `<div id="root">${html}</div>`;
        const errors: unknown[][] = [];
        const spy = vi.spyOn(console, "error").mockImplementation((...a: unknown[]) => { errors.push(a); });
        const before = document.getElementById("root")!.innerHTML;
        await act(async () => { hydrateRoot(document.getElementById("root")!, createElement(PublicApp, { state: s }), { onRecoverableError: (e) => errors.push([e]) }); });
        spy.mockRestore();
        expect(errors).toEqual([]);
        expect(document.getElementById("root")!.innerHTML).toBe(before);
        const input = document.querySelector<HTMLInputElement>("input[name=q]");
        if (input) {
          const set = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!;
          await act(async () => { set.call(input, "cardio"); input.dispatchEvent(new Event("input", { bubbles: true })); });
          expect(input.value).toBe("cardio");
        }
      });
    }
  }
});
