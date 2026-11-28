// Regenerates public/og-image.png (link preview of the patient site: logo plus the three claims). Run: node scripts/make-og-image.mjs (needs Playwright Chromium).
import { chromium } from 'playwright'; import { readFileSync, writeFileSync } from 'node:fs'; import path from 'node:path'; import { fileURLToPath } from 'node:url';
const here = path.dirname(fileURLToPath(import.meta.url)); const pub = path.resolve(here, '../public');
const b64 = (f, t) => `data:${t};base64,${readFileSync(path.join(pub, f)).toString('base64')}`;
const logo = readFileSync(path.join(pub, 'kiorex-logo-full.svg'), 'utf8');
const html = `<html><head><style>@font-face{font-family:P;src:url(${b64('fonts/plus-jakarta-sans-600.woff2', 'font/woff2')});font-weight:600}
body{margin:0;width:1200px;height:630px;background:linear-gradient(135deg,#F5F7FF,#E6EAF7);font-family:P;position:relative;overflow:hidden}
.logo{position:absolute;left:0;right:0;top:92px;display:flex;justify-content:center}.logo svg{height:210px;width:auto}
.claims{position:absolute;left:60px;right:60px;top:410px;display:flex;gap:18px;justify-content:center}
.c{padding:16px 28px;border-radius:999px;background:#fff;color:#1E1B4B;font-size:29px;font-weight:600;border:2px solid #3730A322;display:flex;align-items:center;gap:12px}
.c i{width:14px;height:14px;border-radius:50%;display:block}.url{position:absolute;top:520px;width:100%;text-align:center;font-size:26px;color:#475569}
.bar{position:absolute;left:0;bottom:0;height:12px;width:100%;background:linear-gradient(90deg,#3730A3 66%,#0369A1 66%)}</style></head><body>
<div class="logo">${logo}</div><div class="claims"><div class="c"><i style="background:#3730A3"></i>Verified, not just listed</div><div class="c"><i style="background:#0369A1"></i>Real slots</div><div class="c"><i style="background:#E8735E"></i>Know the fee upfront</div></div>
<div class="url">Book trusted doctors · احجز مع أطباء موثّقين</div><div class="bar"></div></body></html>`;
const br = await chromium.launch(); const p = await br.newPage({ viewport: { width: 1200, height: 630 } }); await p.setContent(html); await p.waitForTimeout(500);
writeFileSync(path.join(pub, 'og-image.png'), await p.screenshot({ type: 'png' })); await br.close(); console.log('og-image.png written');
