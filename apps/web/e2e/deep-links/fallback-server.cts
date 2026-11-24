// Tiny server for the deep link fallback page tests (GRW-P1-H). It serves the REAL renderer and validators from apps/api (pure modules, no Nest, no DB)
// and records what the page POSTs to the touch endpoint, so the browser test can prove "nothing before consent". Port 4391 (never 3000/5173/5175/3020/5190/5191).
import { createServer } from "node:http";
import { isRefCode, isSafeSegment, normalizeProviderCode, normalizeLocale } from "../../../api/src/market/deep-link-rules";
import { landingHeaders, newNonce, renderLanding, safeStoreUrl, type LandingKind } from "../../../api/src/market/link-landing";

const PORT = Number(process.env.DEEPLINK_FALLBACK_PORT ?? 4391);
const touches: unknown[] = [];
const WEB = `http://localhost:${PORT}/web`;

createServer((req, res) => {
  const u = new URL(req.url ?? "/", `http://localhost:${PORT}`);
  if (req.method === "POST" && u.pathname === "/api/v1/growth/v1/touch") {
    let b = ""; req.on("data", (c) => (b += c)); req.on("end", () => { try { touches.push(JSON.parse(b)); } catch { touches.push({ invalid: true }); } res.writeHead(202, { "content-type": "application/json" }).end(JSON.stringify({ accepted: true, visitorKeySet: false })); });
    return;
  }
  if (u.pathname === "/__touches") { res.writeHead(200, { "content-type": "application/json" }).end(JSON.stringify(touches)); return; }
  if (u.pathname === "/__reset") { touches.length = 0; res.writeHead(204).end(); return; }
  if (u.pathname.startsWith("/web")) { res.writeHead(200, { "content-type": "text/html" }).end("<!doctype html><title>web fallback</title><h1 id=webhome>Kiorex web</h1>"); return; }
  const m = /^\/(r|q|a|appointment)\/([^/]+)$/.exec(u.pathname);
  if (req.method !== "GET" || !m) { res.writeHead(404).end(); return; }
  let id: string | null; let kind: LandingKind;
  const seg = (() => { try { return decodeURIComponent(m[2]!); } catch { return ""; } })();
  if (m[1] === "r") { kind = "referral"; id = isRefCode(seg) ? seg : null; }
  else if (m[1] === "q") { kind = "provider"; id = normalizeProviderCode(seg); }
  else { kind = "appointment"; id = isSafeSegment(seg) ? seg : null; }
  if (!id) { res.writeHead(404, { "content-type": "application/json" }).end(JSON.stringify({ code: "LINK_INVALID" })); return; }
  const nonce = newNonce();
  const html = renderLanding({
    kind, value: id, locale: normalizeLocale(u.searchParams.get("l")), cc: "eg", webUrl: kind === "appointment" ? `${WEB}/appointments/${id}` : `${WEB}/?ref=${id}`,
    iosStoreUrl: safeStoreUrl("https://apps.apple.com/app/id0000000000", "ios"), androidStoreUrl: safeStoreUrl("https://play.google.com/store/apps/details?id=com.kiorex.app", "android"), nonce, draftMarker: true,
  });
  res.writeHead(200, landingHeaders(nonce)).end(html);
}).listen(PORT, () => process.stdout.write(`[deeplink-fallback] :${PORT}\n`));
