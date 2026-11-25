"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.esc = exports.newNonce = void 0;
exports.safeStoreUrl = safeStoreUrl;
exports.safeWebOrigin = safeWebOrigin;
exports.renderLanding = renderLanding;
exports.landingHeaders = landingHeaders;
const node_crypto_1 = require("node:crypto");
const newNonce = () => (0, node_crypto_1.randomBytes)(16).toString('base64url');
exports.newNonce = newNonce;
const esc = (s) => s.replace(/[&<>"'`]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;', '`': '&#96;' })[c]);
exports.esc = esc;
const STORE_HOSTS = { ios: 'apps.apple.com', android: 'play.google.com' };
function safeStoreUrl(v, which) {
    if (!v)
        return null;
    try {
        const u = new URL(v);
        return u.protocol === 'https:' && u.hostname === STORE_HOSTS[which] && !u.username && !u.password && !u.hash ? u.toString() : null;
    }
    catch {
        return null;
    }
}
function safeWebOrigin(v, isProd) {
    if (!v)
        return null;
    try {
        const u = new URL(v);
        if (u.username || u.password || u.search || u.hash || u.pathname !== '/')
            return null;
        return u.protocol === 'https:' || (!isProd && u.protocol === 'http:') ? u.origin : null;
    }
    catch {
        return null;
    }
}
const T = {
    ar: {
        dir: 'rtl', title: 'افتح كيوريكس', lead: 'افتح الرابط في تطبيق كيوريكس أو تابع على الموقع.', open: 'افتح في التطبيق', web: 'تابع على الموقع', ios: 'حمّل من App Store', android: 'حمّل من Google Play',
        consent: 'هل تسمح لنا بربط هذا الرابط بجهازك لاحتساب مصدر الحجز؟ لا نستخدم بصمة الجهاز ولا نتتبع موقعك.', allow: 'أسمح', decline: 'ليس الآن',
        claim: 'رمز الإحالة: أدخله مرة واحدة في التطبيق بعد التثبيت', apptLead: 'لإدارة موعدك افتح الرابط في التطبيق أو سجّل الدخول على الموقع.', draft: 'نص مسودة بانتظار الاعتماد القانوني',
    },
    en: {
        dir: 'ltr', title: 'Open Kiorex', lead: 'Open this link in the Kiorex app, or continue on the website.', open: 'Open in the app', web: 'Continue on the web', ios: 'Download on the App Store', android: 'Get it on Google Play',
        consent: 'May we remember this link on your device so the booking can be credited to where you came from? We do not fingerprint your device or track your location.', allow: 'Allow', decline: 'Not now',
        claim: 'Referral code: enter it once in the app after installing', apptLead: 'To manage your appointment open this link in the app, or sign in on the website.', draft: 'Draft wording pending legal approval',
    },
};
function renderLanding(i) {
    const t = T[i.locale];
    const code = (0, exports.esc)(i.value);
    const scheme = i.kind === 'referral' ? `kiorex://r/${i.value}` : i.kind === 'provider' ? `kiorex://q/${i.value}` : `kiorex://appointment/${i.value}`;
    const schemeUrl = (0, exports.esc)(i.cc ? `${scheme}?cc=${i.cc}` : scheme);
    const attributable = i.kind !== 'appointment';
    const landingKind = i.kind === 'provider' ? 'PROVIDER_LINK' : 'REFERRAL';
    const referrerKind = i.kind === 'provider' ? 'p' : 'r';
    const play = i.androidStoreUrl;
    const playBase = play ? (0, exports.esc)(play) : '';
    const consent = attributable
        ? `<section id="consent" aria-labelledby="ct"><p id="ct">${t.consent}${i.draftMarker ? ` <em class="draft">[${t.draft}]</em>` : ''}</p><div class="row"><button type="button" id="allow" class="btn">${t.allow}</button><button type="button" id="decline" class="btn">${t.decline}</button></div></section>
<section id="claim" hidden><p>${t.claim}</p><p class="code" dir="ltr">${code}</p></section>`
        : '';
    return `<!doctype html>
<html lang="${i.locale}" dir="${t.dir}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><meta name="referrer" content="no-referrer"><title>${t.title}</title>
<style nonce="${i.nonce}">:root{color-scheme:light dark;--ink:#3730A3;--bg:#F4F6FC;--fg:#14142b}@media(prefers-color-scheme:dark){:root{--bg:#0F1024;--fg:#eef0ff;--ink:#A5B4FC}}body{margin:0;font:16px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);display:grid;place-items:center;min-height:100vh}main{max-width:26rem;padding:24px 16px;width:100%;box-sizing:border-box}h1{font-size:1.4rem;margin:0 0 .5rem;color:var(--ink)}.row{display:flex;gap:12px;flex-wrap:wrap;margin:12px 0}.btn{flex:1 1 9rem;padding:12px 16px;border-radius:12px;border:2px solid var(--ink);background:transparent;color:var(--ink);font:inherit;font-weight:600;text-align:center;text-decoration:none;cursor:pointer;min-height:44px}.btn.primary{background:var(--ink);color:#fff}.code{font:700 1.5rem/1.2 ui-monospace,monospace;letter-spacing:.15em;padding:12px;border:1px dashed var(--ink);border-radius:12px;text-align:center}.draft{opacity:.7}[hidden]{display:none!important}</style></head>
<body data-kind="${landingKind}" data-code="${code}" data-attr="${attributable ? '1' : '0'}"><main>
<h1>${t.title}</h1><p>${i.kind === 'appointment' ? t.apptLead : t.lead}</p>
<div class="row"><a class="btn primary" id="open" href="${schemeUrl}" rel="noopener">${t.open}</a><a class="btn" id="web" href="${(0, exports.esc)(i.webUrl)}" rel="noopener">${t.web}</a></div>
<div class="row">${i.iosStoreUrl ? `<a class="btn" id="ios" href="${(0, exports.esc)(i.iosStoreUrl)}" rel="noopener">${t.ios}</a>` : ''}${play ? `<a class="btn" id="android" href="${playBase}" data-base="${playBase}"${attributable ? ` data-referrer-kind="${referrerKind}"` : ''} rel="noopener">${t.android}</a>` : ''}</div>
${consent}
${attributable ? `<script nonce="${i.nonce}">(function(){var t0=Date.now(),d=document.body.dataset;if(d.attr!=='1')return;var c=document.getElementById('consent'),claim=document.getElementById('claim');
function done(){c.hidden=true}
document.getElementById('decline').addEventListener('click',done);
document.getElementById('allow').addEventListener('click',function(){done();
try{fetch('/api/v1/growth/v1/touch',{method:'POST',credentials:'include',headers:{'Content-Type':'application/json'},body:JSON.stringify({landingKind:d.kind,ref:d.code,dwellMs:Math.min(Date.now()-t0,600000)})}).catch(function(){})}catch(e){}
var a=document.getElementById('android');if(a){var b=a.getAttribute('data-base');a.setAttribute('href',b+(b.indexOf('?')<0?'?':'&')+'referrer='+encodeURIComponent('kxref='+a.getAttribute('data-referrer-kind')+'.'+d.code))}
if(claim)claim.hidden=false});})();</script>` : ''}
</main></body></html>`;
}
function landingHeaders(nonce) {
    return {
        'Content-Type': 'text/html; charset=utf-8',
        'Content-Security-Policy': `default-src 'none'; script-src 'nonce-${nonce}'; style-src 'nonce-${nonce}'; connect-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`,
        'Referrer-Policy': 'no-referrer',
        'Cache-Control': 'no-store',
        'X-Content-Type-Options': 'nosniff',
        'X-Robots-Tag': 'noindex, nofollow',
    };
}
//# sourceMappingURL=link-landing.js.map