"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snippetsFor = snippetsFor;
const esc = (s) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
function snippetsFor(i) {
    const base = i.base.replace(/\/+$/, '');
    const slug = encodeURIComponent(i.slug);
    const doc = i.doctor ? ` data-doctor="${esc(i.doctor)}"` : '';
    const div = `<div data-kx-widget data-org="${esc(i.slug)}"${doc} data-locale="${i.locale}"></div>`;
    return {
        script: `<script src="${base}/v1/sdk.js" async></script>\n${div}`,
        scriptPinned: i.sdkPath && i.integrity ? `<script src="${base}${i.sdkPath}" integrity="${i.integrity}" crossorigin="anonymous" async></script>\n${div}` : null,
        iframe: `<iframe src="${base}/v1/embed/${slug}?locale=${i.locale}${i.doctor ? `&doctor=${encodeURIComponent(i.doctor)}` : ''}" title="${i.locale === 'ar' ? 'احجز موعدك' : 'Book an appointment'}" width="100%" height="640" style="border:0" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>`,
    };
}
//# sourceMappingURL=widget-snippets.js.map