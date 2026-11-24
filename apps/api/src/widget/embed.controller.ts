import { DEFAULT_MARKET, marketTimezone } from '../market/market-core-public';
import { Injectable, Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import { resolveBrand } from './brand';
import { FlagsService } from '../control-plane/control-plane-public';
import { WidgetAssets } from './widget-assets';
import { WidgetAuditService } from './widget-audit.service';
import { frameAncestorsOf, originOfUrl, widgetSelfOrigin } from './widget-origins';
import { WidgetPolicyService } from './widget-policy.service';
import { WidgetRegistrationService } from './widget-registration.service';
import { snippetsFor } from './widget-snippets';
import { widgetCfg } from './widget.config';

/** Escape for HTML text and attribute values. */
const h = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
/** JSON for a `<script type="application/json">` block: `<` and the line separators cannot end the element or the script. */
const jsonScript = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
const TOKEN = /^[A-Za-z0-9._~-]{1,512}$/; const SLUGISH = /^[A-Za-z0-9_-]{1,80}$/; const SPEC = /^[a-z0-9_-]{1,40}$/; const REFC = /^[A-Za-z0-9_-]{1,80}$/;

const TEXT: Record<'ar' | 'en', Record<string, string>> = {
  en: { denied: 'This booking form cannot be shown on this website.', missing: 'This booking form could not be found.', off: 'Online booking is paused right now.', embedded: 'This booking form must be embedded in a page.', nojs: 'Online booking needs JavaScript.', title: 'Book an appointment', unavailable: 'Online booking is not available right now.' },
  ar: { denied: 'لا يمكن عرض نموذج الحجز هذا على هذا الموقع.', missing: 'لم نعثر على نموذج الحجز هذا.', off: 'الحجز الإلكتروني متوقف مؤقتًا.', embedded: 'يجب تضمين نموذج الحجز هذا داخل صفحة.', nojs: 'الحجز الإلكتروني يحتاج إلى JavaScript.', title: 'احجز موعدك', unavailable: 'الحجز الإلكتروني غير متاح الآن.' },
};

/**
 * Express handlers of the widget host (GRW-P1-G). Mounted at the host root by WidgetMounter (the Nest routes live under /api/v1). Every document carries an exact CSP:
 * the embed shell's `frame-ancestors` is the organisation's verified origin list (or 'none'), every other document of this host says `frame-ancestors 'none'` (ADR-038).
 */
@Injectable()
export class EmbedHandlers {
  private readonly log = new Logger('widget');
  constructor(private readonly flags: FlagsService, private readonly regs: WidgetRegistrationService, private readonly audit: WidgetAuditService, private readonly assets: WidgetAssets, private readonly policy: WidgetPolicyService) {}

  // ---- plumbing ------------------------------------------------------------------------------------------------------------------------------
  private hostOk(req: Request): boolean {
    const c = widgetCfg();
    if (!c.enabled) return false;
    return !c.host || String(req.headers.host ?? '').toLowerCase() === c.host;
  }
  private base(req: Request): string { return widgetSelfOrigin(req.protocol, req.headers.host as string | undefined) ?? `${req.protocol}://${req.headers.host}`; }
  private secure(res: Response, ancestors: string, extra: Record<string, string> = {}) {
    res.set({
      'Content-Security-Policy': `default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' https: data:; font-src 'self'; connect-src 'self' ${widgetCfg().oidcAuthority}; form-action 'none'; base-uri 'none'; frame-src 'self'; frame-ancestors ${ancestors}`,
      'X-Content-Type-Options': 'nosniff', 'Referrer-Policy': 'strict-origin-when-cross-origin', 'Permissions-Policy': 'camera=(), microphone=(), geolocation=(), payment=()', 'Cache-Control': 'private, no-store', ...extra,
    });
    if (ancestors === "'none'") res.set('X-Frame-Options', 'DENY');
    if (widgetCfg().host) res.set('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  }
  private page(res: Response, status: number, lang: 'ar' | 'en', key: string, code: string, extra: Record<string, unknown> = {}) {
    const tx = TEXT[lang];
    this.secure(res, "'none'");
    if (res.req.headers.accept?.includes('application/json') && !res.req.headers.accept.includes('text/html')) { res.status(status).json({ code, message: tx[key], ...extra }); return; }
    res.status(status).type('html').send(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${h(tx.title!)}</title></head><body><p role="alert" data-code="${h(code)}">${h(tx[key]!)}</p></body></html>`);
  }
  private lang(req: Request): 'ar' | 'en' {
    const q = String(req.query.locale ?? '');
    if (q === 'ar' || q === 'en') return q;
    return /^\s*ar/i.test(String(req.headers['accept-language'] ?? '')) ? 'ar' : 'en';
  }
  private async enabled(): Promise<{ key: string; scope: string } | null> {
    const r = await this.flags.evaluate('growth.widgets', { market: DEFAULT_MARKET });
    return r.effective ? null : { key: 'growth.widgets', scope: r.scope ?? 'GLOBAL' };
  }
  private notBuilt(res: Response) { this.secure(res, "'none'"); res.status(503).json({ code: 'WIDGET_NOT_BUILT', message: 'The widget build is not available on this instance' }); }

  // ---- GET /v1/embed/:orgSlug -------------------------------------------------------------------------------------------------------------------
  shell = async (req: Request, res: Response): Promise<void> => {
    try {
      const lang = this.lang(req);
      if (!this.hostOk(req)) { res.status(404).type('text/plain').send('Not found'); return; }
      const off = await this.enabled();
      if (off) { this.page(res, 403, lang, 'off', 'FEATURE_DISABLED', off); return; }
      if (!this.assets.ready()) { this.notBuilt(res); return; }
      const slug = String(req.params.orgSlug ?? '');
      const reg = await this.regs.resolve(slug);
      if (!reg) { this.page(res, 404, lang, 'missing', 'WIDGET_NOT_FOUND'); return; }
      const self = this.base(req);
      const sandbox = req.query.sandbox === '1' && widgetCfg().sandbox;
      const origins = this.regs.effectiveOrigins(reg);
      const ancestors = sandbox ? [...new Set([...origins, self])] : origins;
      const ref = originOfUrl(req.headers.referer);
      if (ref && !ancestors.includes(ref)) { await this.audit.denied(reg.orgRef, ref, 'REFERER_NOT_ALLOWED', 'embed'); this.page(res, 403, lang, 'denied', 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED'); return; }
      if (req.headers['sec-fetch-dest'] === 'document' && !sandbox) { await this.audit.denied(reg.orgRef, ref ?? '', 'MUST_BE_EMBEDDED', 'embed'); this.page(res, 403, lang, 'embedded', 'WIDGET_MUST_BE_EMBEDDED'); return; }
      if (!ancestors.length) { await this.audit.denied(reg.orgRef, ref ?? '', 'ORIGIN_NOT_ALLOWED', 'embed'); this.page(res, 403, lang, 'denied', 'GROWTH_WIDGET_ORIGIN_NOT_ALLOWED'); return; }

      const q = req.query;
      const one = (v: unknown, re: RegExp) => (typeof v === 'string' && re.test(v) ? v : null);
      const brand = resolveBrand({ color: typeof q.color === 'string' ? q.color : undefined, radius: typeof q.radius === 'string' ? q.radius : undefined, logo: typeof q.logo === 'string' ? q.logo : undefined });
      const boot = {
        org: reg.orgSlug ?? reg.orgRef, locale: lang, brand, doctor: one(q.doctor, SLUGISH), specialty: one(q.specialty, SPEC), po: originOfUrl(typeof q.po === 'string' ? q.po : null), sandbox,
        lt: one(q.lt, TOKEN), ref: one(q.ref, REFC), authority: widgetCfg().oidcAuthority, clientId: widgetCfg().oidcClientId, self, version: this.assets.sdkFile().manifest.version, tz: marketTimezone(DEFAULT_MARKET),
      };
      const a = this.assets.appFiles();
      this.secure(res, frameAncestorsOf(ancestors));
      res.status(200).type('html').send(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${h(TEXT[lang].title!)}</title>${a.css ? `<link rel="stylesheet" href="/v1/embed/assets/${a.css}">` : ''}<script type="application/json" id="kx-boot">${jsonScript(boot)}</script><script type="module" src="/v1/embed/assets/${a.main}"></script></head><body><div id="root"></div><noscript>${h(TEXT[lang].nojs!)}</noscript></body></html>`);
    } catch (e) { this.fail(res, e); }
  };

  // ---- static assets and the popup return page ---------------------------------------------------------------------------------------------------
  asset = (req: Request, res: Response): void => {
    try {
      if (!this.hostOk(req)) { res.status(404).end(); return; }
      const f = this.assets.appAsset(String(req.params.file ?? ''));
      if (!f) { res.status(404).end(); return; }
      res.set({ 'Content-Type': f.type, 'Cache-Control': 'public, max-age=31536000, immutable', 'X-Content-Type-Options': 'nosniff', 'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'" }).status(200).send(f.body);
    } catch (e) { this.fail(res, e); }
  };

  callback = (req: Request, res: Response): void => {
    try {
      if (!this.hostOk(req)) { res.status(404).end(); return; }
      if (!this.assets.ready()) { this.notBuilt(res); return; }
      const lang = this.lang(req);
      this.secure(res, "'none'", { 'Referrer-Policy': 'no-referrer' });
      res.status(200).type('html').send(`<!doctype html><html lang="${lang}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex"><title>${h(TEXT[lang].title!)}</title></head><body><p id="msg" hidden>${lang === 'ar' ? 'يمكنك إغلاق هذه النافذة.' : 'You can close this window.'}</p><script src="/v1/embed/assets/${this.assets.appFiles().callback}"></script></body></html>`);
    } catch (e) { this.fail(res, e); }
  };

  // ---- SDK ---------------------------------------------------------------------------------------------------------------------------------------
  sdk = (immutable: boolean) => async (req: Request, res: Response): Promise<void> => {
    try {
      if (!this.hostOk(req)) { res.status(404).end(); return; }
      const off = await this.enabled();
      if (off) { res.set({ 'Cache-Control': 'no-store', 'Access-Control-Allow-Origin': '*' }).status(403).json({ code: 'FEATURE_DISABLED', message: 'Feature temporarily unavailable', ...off }); return; }
      if (!this.assets.ready()) { this.notBuilt(res); return; }
      const f = this.assets.sdkFile();
      if (immutable && (req.params as Record<string, string>)[0] !== f.manifest.hash) { res.status(404).set('Cache-Control', 'no-store').end(); return; }
      const sec = (await this.policy.get()).sdkCacheSeconds;
      res.set({
        'Content-Type': 'text/javascript; charset=utf-8', 'X-Content-Type-Options': 'nosniff', 'Access-Control-Allow-Origin': '*', 'Cross-Origin-Resource-Policy': 'cross-origin',
        'Cache-Control': immutable ? `public, max-age=${sec}, immutable` : 'public, max-age=300, stale-while-revalidate=86400', ETag: f.etag,
      });
      if (req.headers['if-none-match'] === f.etag) { res.status(304).end(); return; }
      res.status(200).send(f.body);
    } catch (e) { this.fail(res, e); }
  };

  /** GET /v1/sdk.json: version, immutable path and the SRI value (Clinic and Docs/WIDGET.md read it; the hash changes with every SDK release). */
  sdkInfo = (req: Request, res: Response): void => {
    try {
      if (!this.hostOk(req)) { res.status(404).end(); return; }
      if (!this.assets.ready()) { this.notBuilt(res); return; }
      const m = this.assets.sdkFile().manifest;
      res.set({ 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'public, max-age=300', 'X-Content-Type-Options': 'nosniff' }).status(200).json({ ...m, url: `${this.base(req)}${m.path}`, rollingUrl: `${this.base(req)}/v1/sdk.js` });
    } catch (e) { this.fail(res, e); }
  };

  // ---- sandbox demo page for providers ---------------------------------------------------------------------------------------------------------
  sandbox = async (req: Request, res: Response): Promise<void> => {
    try {
      const lang = this.lang(req);
      if (!this.hostOk(req) || !widgetCfg().sandbox) { res.status(404).type('text/plain').send('Not found'); return; }
      const off = await this.enabled();
      if (off) { this.page(res, 403, lang, 'off', 'FEATURE_DISABLED', off); return; }
      if (!this.assets.ready()) { this.notBuilt(res); return; }
      const slug = String(req.query.org ?? '');
      const reg = slug ? await this.regs.resolve(slug) : null;
      if (!reg) { this.page(res, 404, lang, 'missing', 'WIDGET_NOT_FOUND'); return; }
      const m = this.assets.sdkFile().manifest; const base = this.base(req); const a = this.assets.appFiles();
      const doctor = typeof req.query.doctor === 'string' && SLUGISH.test(req.query.doctor) ? req.query.doctor : undefined;
      const sn = snippetsFor({ base, slug: reg.orgSlug ?? reg.orgRef, locale: lang, doctor, sdkPath: m.path, integrity: m.integrity });
      const origins = this.regs.effectiveOrigins(reg).length;
      this.secure(res, "'none'");
      const T = lang === 'ar'
        ? { h: 'صفحة تجربة الحجز', p: 'هذه صفحة تجريبية على مضيف الأداة نفسه. الحجز هنا حقيقي لكن عبر مزوّدات تجريبية. للنشر على موقعك أضف أصل موقعك ضمن «مواقع مسموح بها» في إعدادات النمو بعيادتك.', live: 'الأداة', snip: 'مقتطفات التضمين', rolling: 'السكربت (أحدث إصدار)', pinned: 'السكربت (مثبّت مع SRI)', ifr: 'إطار iframe بسيط (بدون SDK)', ao: 'عدد المواقع المسموح بها' }
        : { h: 'Booking widget sandbox', p: 'A demo page on the widget host itself. Bookings are real but use test providers. To publish on your site, add your site origin under "Allowed sites" in your clinic Growth settings.', live: 'Live widget', snip: 'Embed snippets', rolling: 'Script (latest version)', pinned: 'Script (pinned with SRI)', ifr: 'Plain iframe (no SDK)', ao: 'Allowed sites configured' };
      res.status(200).type('html').send(`<!doctype html><html lang="${lang}" dir="${lang === 'ar' ? 'rtl' : 'ltr'}"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow"><title>${h(T.h)}</title>${a.css ? `<link rel="stylesheet" href="/v1/embed/assets/${a.css}">` : ''}</head><body><main class="kx wide"><h1>${h(T.h)}</h1><p class="muted">${h(T.p)}</p><p class="muted">${h(T.ao)}: ${origins}</p><h2>${h(T.live)}</h2><div data-kx-widget data-sandbox data-org="${h(reg.orgSlug ?? reg.orgRef)}" data-locale="${lang}"${doctor ? ` data-doctor="${h(doctor)}"` : ''}></div><h2>${h(T.snip)}</h2><h3>${h(T.rolling)}</h3><pre dir="ltr" class="card code">${h(sn.script)}</pre><h3>${h(T.pinned)}</h3><pre dir="ltr" class="card code">${h(sn.scriptPinned ?? '')}</pre><h3>${h(T.ifr)}</h3><pre dir="ltr" class="card code">${h(sn.iframe)}</pre></main><script src="/v1/sdk.js" async></script></body></html>`);
    } catch (e) { this.fail(res, e); }
  };

  private fail(res: Response, e: unknown) {
    if (e instanceof Error && e.message === 'WIDGET_NOT_BUILT') { this.notBuilt(res); return; }
    this.log.error(e instanceof Error ? e.stack : String(e));
    if (!res.headersSent) { this.secure(res, "'none'"); res.status(500).json({ code: 'INTERNAL_ERROR', message: 'Unexpected error' }); }
  }
}
