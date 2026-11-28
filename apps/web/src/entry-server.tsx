import "./lib/western-digits";
import { renderToPipeableStream } from "react-dom/server";
import { Writable } from "node:stream";
import { createElement } from "react";
import { PublicApp, buildCtx } from "./public/PublicApp";
import { createPublicI18n } from "./public/i18n";
import { getTemplate } from "./public/registry";
import { matchPublicPath } from "./public/routes";
import type { PublicState, SsrInput, SsrOutput } from "./public/types";

/**
 * SSR entry (GRW-P1-E). The Kiorex API loads this bundle (CommonJS, self-contained, apps/web/dist-public/server/entry-server.cjs) and calls
 * `render` with PLAIN JSON that it loaded from public APIs and services: the bundle never fetches, never reads cookies and never sees a user.
 * React 19 `renderToPipeableStream` renders the tree; the response is buffered until `onAllReady` because the server needs the complete body for the
 * ETag and the CDN cache (Suspense boundaries are therefore resolved, not streamed to the browser).
 */
export { PUBLIC_ROUTES, matchPublicPath, publicPath } from "./public/routes";
export { registerTemplate, registeredTypes } from "./public/registry";

function renderBody(state: PublicState): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    let out = "";
    const sink = new Writable({ write(chunk, _enc, cb) { out += chunk.toString("utf8"); cb(); } });
    sink.on("finish", () => resolve(out));
    let failed = false;
    const stream = renderToPipeableStream(createElement(PublicApp, { state }), {
      onAllReady() { stream.pipe(sink); },
      onShellError(err) { failed = true; reject(err); },
      onError(err) { if (!failed) { failed = true; reject(err); } },
    });
    setTimeout(() => { if (!failed) { failed = true; stream.abort(); reject(new Error("SSR render timed out")); } }, 4000).unref?.();
  });
}

export async function render(input: SsrInput): Promise<SsrOutput> {
  // the route table is shared with the client: a path the table does not know is a bug in the caller, not a page to guess
  if (input.type !== "not-found") {
    const m = matchPublicPath(input.path);
    if (!m || m.type !== input.type) throw new Error(`route mismatch: ${input.path} is not ${input.type}`);
  }
  const state: PublicState = { ...input };
  const tpl = getTemplate(input.type);
  if (!tpl) throw new Error(`no template for ${input.type}`);
  const ctx = buildCtx(state, createPublicI18n(input.locale));
  const html = await renderBody(state);
  return { html, meta: tpl.meta(input.data, ctx), jsonLd: tpl.jsonLd ? tpl.jsonLd(input.data, ctx) : [] };
}
