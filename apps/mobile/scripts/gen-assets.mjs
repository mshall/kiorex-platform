// Renders the Kiorex app icon, adaptive icon, splash mark and favicon from the brand SVG geometry (KX-19 / _brand).
import sharp from "sharp";
import { mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const out = join(dirname(fileURLToPath(import.meta.url)), "../assets");
mkdirSync(out, { recursive: true });

// 120x80 brand mark geometry scaled around the centre of a 1024 canvas. White X + coral ECG pulse.
const mark = (stroke1, stroke2, scale, pulseW = 2.5) => `
  <g transform="translate(512 512) scale(${scale}) translate(-60 -40)">
    <line x1="28" y1="6" x2="72" y2="74" stroke="${stroke1}" stroke-width="7"/>
    <line x1="92" y1="6" x2="48" y2="74" stroke="${stroke2}" stroke-width="7"/>
    <polyline points="2,40 52,40 55,35 58,46 62,28 66,44 69,40 118,40" fill="none" stroke="#E8735E" stroke-width="${pulseW}" stroke-linejoin="round" stroke-linecap="round"/>
  </g>`;
const svg = (body, bg = true) => `<svg xmlns="http://www.w3.org/2000/svg" width="1024" height="1024" viewBox="0 0 1024 1024">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="#3730A3"/><stop offset="1" stop-color="#0369A1"/></linearGradient></defs>
  ${bg ? '<rect width="1024" height="1024" fill="url(#g)"/>' : ""}${body}</svg>`;

const render = (s, size, file) => sharp(Buffer.from(s)).resize(size, size).png().toFile(join(out, file));
await render(svg(mark("#FFFFFF", "#FFFFFF", 6.2, 3.2)), 1024, "icon.png");
await render(svg(mark("#FFFFFF", "#FFFFFF", 4.6, 3.2), false), 1024, "adaptive-icon.png"); // safe zone padding
await render(svg(mark("#FFFFFF", "#FFFFFF", 5.4, 3.2), false), 1024, "splash-icon.png");
await render(svg(mark("#FFFFFF", "#FFFFFF", 6.2, 3.2)), 96, "favicon.png");
console.log("assets written to", out);
