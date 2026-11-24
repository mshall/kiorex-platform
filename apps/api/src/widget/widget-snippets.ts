/** Embed snippets (pure). `base` is the widget origin (https://book.kiorex.com); only public values appear: the clinic slug, the SDK path and its SRI hash. */
export interface SnippetInput { base: string; slug: string; locale: 'ar' | 'en'; doctor?: string; sdkPath?: string; integrity?: string }
const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export function snippetsFor(i: SnippetInput) {
  const base = i.base.replace(/\/+$/, '');
  const slug = encodeURIComponent(i.slug);
  const doc = i.doctor ? ` data-doctor="${esc(i.doctor)}"` : '';
  const div = `<div data-kx-widget data-org="${esc(i.slug)}"${doc} data-locale="${i.locale}"></div>`;
  return {
    /** Rolling: always the latest 1.x SDK (short cache); no integrity attribute because the bytes change on every release. */
    script: `<script src="${base}/v1/sdk.js" async></script>\n${div}`,
    /** Pinned: immutable versioned path + Subresource Integrity (crossorigin is required for SRI on a cross-origin script). */
    scriptPinned: i.sdkPath && i.integrity ? `<script src="${base}${i.sdkPath}" integrity="${i.integrity}" crossorigin="anonymous" async></script>\n${div}` : null,
    iframe: `<iframe src="${base}/v1/embed/${slug}?locale=${i.locale}${i.doctor ? `&doctor=${encodeURIComponent(i.doctor)}` : ''}" title="${i.locale === 'ar' ? 'احجز موعدك' : 'Book an appointment'}" width="100%" height="640" style="border:0" loading="lazy" sandbox="allow-scripts allow-same-origin allow-popups allow-popups-to-escape-sandbox allow-forms"></iframe>`,
  };
}
