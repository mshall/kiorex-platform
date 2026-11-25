import { Injectable } from '@nestjs/common';
import { newId } from '../../common/ids';
import { PrismaService } from '../../prisma/prisma.service';
import { forbidden, ApiError } from '../../common/errors';
import { growthError } from '../growth-errors';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { claims } from './checks/claims';
import { titleMeta } from './checks/title-meta';
import type { CheckContext, PageContent } from './page-model';
import { SeoAutomationService } from './seo-automation.service';
import type { LandingEditPort, LandingEditView } from './seo-automation-public';

export interface EditActor { sub: string; roles: string[] }
const LISTING_TYPES = ['hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine'];
const TITLE_MAX = 120; const DESC_MAX = 320;
const KEY_RE = /^([a-z-]+):([a-z0-9-]{1,80}(?:\/[a-z0-9-]{1,80}){0,2})$/;
const isSuper = (a: EditActor) => a.roles.includes('super_admin');
const deny = (message: string) => forbidden('FORBIDDEN_ROLE', message, { required: ['super_admin'] });
const qualityError = (message: string, extra: Record<string, unknown>) => new ApiError(422, 'LANDING_EDIT_QUALITY', message, extra);

/**
 * G-18 editorial title and description of a generated LISTING page (hub, city, district, ...), per locale. Maker-checker: the approver is a different super admin (also a database CHECK);
 * the content quality gate of the SEO automation (forbidden claims, title and description length, leaked placeholders) runs when the edit is submitted and its result is stored with it; a
 * blocking failure refuses the submit. One ACTIVE edit per page and locale (a new approval supersedes the old one); an ACTIVE edit can be withdrawn at any time and the generated text returns.
 * Provider-owned entity pages are not editable here. Every transition is audited.
 */
@Injectable()
export class LandingEditService implements LandingEditPort {
  private readonly cache = new Map<string, { at: number; v: LandingEditView | null }>();
  constructor(private readonly prisma: PrismaService, private readonly seo: SeoAutomationService) {}

  private ttl() { return process.env.NODE_ENV === 'test' ? 0 : 15_000; }
  private audit(actor: string, action: string, row: { id: string; pageKey: string; locale: string; version: number }, extra: Record<string, unknown> = {}) {
    return this.prisma.auditLog.create({ data: { actor, action: `growth.landing_edit.${action}`, resource: 'GrowthLandingEdit', resourceId: row.id, metadata: { pageKey: row.pageKey, locale: row.locale, version: row.version, ...extra } as never } });
  }
  private async must(id: string) { const r = await this.prisma.growthLandingEdit.findUnique({ where: { id } }); if (!r) throw growthError('GROWTH_CONFIG_NOT_FOUND', 'Landing edit not found'); return r; }

  /** Read side for the public site: the ACTIVE edit of a page and locale or null. Never throws. */
  async activeFor(market: string, pageKey: string, locale: string): Promise<LandingEditView | null> {
    const k = `${market}|${pageKey}|${locale}`; const hit = this.cache.get(k);
    if (hit && Date.now() - hit.at < this.ttl()) return hit.v;
    let v: LandingEditView | null = null;
    try { const r = await this.prisma.growthLandingEdit.findFirst({ where: { market, pageKey, locale, status: 'ACTIVE' }, select: { title: true, description: true, version: true } }); v = r ?? null; } catch { v = null; }
    this.cache.set(k, { at: Date.now(), v }); return v;
  }
  invalidate() { this.cache.clear(); }

  async list(q: { market?: string; status?: string; pageKey?: string; take?: number }) {
    const take = Math.min(200, Math.max(1, Math.floor(q.take ?? 50)));
    return this.prisma.growthLandingEdit.findMany({ where: { market: q.market ?? GROWTH_DEFAULT_MARKET, ...(q.status ? { status: q.status } : {}), ...(q.pageKey ? { pageKey: q.pageKey } : {}) }, orderBy: { updatedAt: 'desc' }, take });
  }

  async createDraft(actor: EditActor, i: { market?: string; pageKey: string; locale: string; title: string; description: string; reason?: string }) {
    if (!isSuper(actor)) throw deny('Only a super admin can draft a landing page edit');
    const market = i.market ?? GROWTH_DEFAULT_MARKET;
    const m = KEY_RE.exec(i.pageKey ?? '');
    if (!m || !LISTING_TYPES.includes(m[1]!)) throw growthError('GROWTH_INVALID_REQUEST', 'pageKey must be a listing page key such as hub:cardiology or district:cardiology/cairo/maadi; provider pages are not editable here');
    if (i.locale !== 'ar' && i.locale !== 'en') throw growthError('GROWTH_INVALID_REQUEST', 'locale must be ar or en');
    const title = (i.title ?? '').trim(); const description = (i.description ?? '').trim();
    if (!title || title.length > TITLE_MAX) throw growthError('GROWTH_INVALID_REQUEST', `title is required and at most ${TITLE_MAX} characters`);
    if (!description || description.length > DESC_MAX) throw growthError('GROWTH_INVALID_REQUEST', `description is required and at most ${DESC_MAX} characters`);
    const last = await this.prisma.growthLandingEdit.aggregate({ where: { market, pageKey: i.pageKey, locale: i.locale }, _max: { version: true } });
    const row = await this.prisma.growthLandingEdit.create({ data: { id: newId('gle'), market, pageKey: i.pageKey, locale: i.locale, version: (last._max.version ?? 0) + 1, title, description, reason: i.reason?.slice(0, 300), createdBy: actor.sub } });
    await this.audit(actor.sub, 'create', row);
    return row;
  }

  async updateDraft(actor: EditActor, id: string, i: { title?: string; description?: string; reason?: string }) {
    const row = await this.must(id);
    if (row.createdBy !== actor.sub) throw deny('Only the author edits a draft');
    if (row.status !== 'DRAFT') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a draft can be edited', { status: row.status });
    const title = (i.title ?? row.title).trim(); const description = (i.description ?? row.description).trim();
    if (!title || title.length > TITLE_MAX || !description || description.length > DESC_MAX) throw growthError('GROWTH_INVALID_REQUEST', 'title or description length is out of range');
    return this.prisma.growthLandingEdit.update({ where: { id }, data: { title, description, ...(i.reason !== undefined ? { reason: i.reason.slice(0, 300) } : {}) } });
  }

  /** Runs the claims and title/description checks of the SEO gate on the edit text. Pure of the database except for the effective config. */
  async quality(market: string, e: { title: string; description: string; locale: string; pageKey: string }) {
    const cfg = await this.seo.config(market);
    const page: PageContent = { pageKey: e.pageKey, templateKind: (e.pageKey.split(':')[0] ?? 'hub') as never, locale: e.locale as never, expectedCanonical: '', title: e.title, description: e.description, h1: [], text: '', jsonLd: [], canonical: '', alternates: [], robots: '', links: [], reviewMarkupRendered: false, visibleReviews: 0 };
    const ctx = { cfg, titleOwners: new Map(), descriptionOwners: new Map() } as unknown as CheckContext;
    const results = [...claims(page, ctx), ...titleMeta(page, ctx)];
    const blocking = results.filter((r) => !r.ok && r.severity === 'block').map((r) => ({ id: r.id, detail: r.detail }));
    const warnings = results.filter((r) => !r.ok && r.severity === 'warn').map((r) => ({ id: r.id, detail: r.detail }));
    return { passed: blocking.length === 0, blocking, warnings, checkedAt: new Date().toISOString() };
  }

  async submit(actor: EditActor, id: string) {
    const row = await this.must(id);
    if (row.createdBy !== actor.sub) throw deny('Only the author submits a draft');
    if (row.status !== 'DRAFT') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a draft can be submitted', { status: row.status });
    const q = await this.quality(row.market, row);
    if (!q.passed) { await this.prisma.growthLandingEdit.update({ where: { id }, data: { quality: q as never } }); throw qualityError( 'The text did not pass the content quality gate', { blocking: q.blocking, warnings: q.warnings }); }
    const r = await this.prisma.growthLandingEdit.updateMany({ where: { id, status: 'DRAFT' }, data: { status: 'PENDING_APPROVAL', quality: q as never, submittedAt: new Date() } });
    if (!r.count) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'The edit changed state meanwhile');
    const out = await this.must(id); await this.audit(actor.sub, 'submit', out, { warnings: q.warnings.length }); return out;
  }

  async approve(actor: EditActor, id: string) {
    if (!isSuper(actor)) throw deny('Only a super admin approves a landing page edit');
    const row = await this.must(id);
    if (row.status !== 'PENDING_APPROVAL') throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a submitted edit can be approved', { status: row.status });
    if (row.createdBy === actor.sub) throw growthError('GROWTH_CONFIG_SELF_APPROVAL', 'The approver must be a different super admin than the author');
    // the gate runs again at approval: the claim list or the length limits may have changed since the submit
    const q = await this.quality(row.market, row);
    if (!q.passed) throw qualityError( 'The text no longer passes the content quality gate', { blocking: q.blocking, warnings: q.warnings });
    const now = new Date();
    await this.prisma.$transaction(async (tx) => {
      await tx.growthLandingEdit.updateMany({ where: { market: row.market, pageKey: row.pageKey, locale: row.locale, status: 'ACTIVE' }, data: { status: 'SUPERSEDED' } });
      const r = await tx.growthLandingEdit.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: 'ACTIVE', decidedBy: actor.sub, decidedAt: now, quality: q as never } });
      if (!r.count) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'The edit changed state meanwhile');
    });
    this.invalidate();
    const out = await this.must(id); await this.audit(actor.sub, 'approve', out); return out;
  }

  async reject(actor: EditActor, id: string, note: string) {
    if (!isSuper(actor)) throw deny('Only a super admin rejects a landing page edit');
    const row = await this.must(id);
    if (row.createdBy === actor.sub) throw growthError('GROWTH_CONFIG_SELF_APPROVAL', 'Reject is a checker action: the author can leave the draft');
    const r = await this.prisma.growthLandingEdit.updateMany({ where: { id, status: 'PENDING_APPROVAL' }, data: { status: 'REJECTED', decidedBy: actor.sub, decidedAt: new Date(), decisionNote: (note ?? '').slice(0, 300) } });
    if (!r.count) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a submitted edit can be rejected', { status: row.status });
    const out = await this.must(id); await this.audit(actor.sub, 'reject', out); return out;
  }

  /** An ACTIVE edit goes away at once (the generated text returns); a draft or submitted one is simply closed. Any super admin, reason required. */
  async withdraw(actor: EditActor, id: string, reason: string) {
    if (!isSuper(actor)) throw deny('Only a super admin withdraws a landing page edit');
    if ((reason ?? '').trim().length < 10) throw growthError('GROWTH_INVALID_REQUEST', 'A reason of at least 10 characters is required');
    const row = await this.must(id);
    const r = await this.prisma.growthLandingEdit.updateMany({ where: { id, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'ACTIVE'] } }, data: { status: 'WITHDRAWN', decidedBy: actor.sub, decidedAt: new Date(), decisionNote: reason.trim().slice(0, 300) } });
    if (!r.count) throw growthError('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'This edit is already closed', { status: row.status });
    this.invalidate();
    const out = await this.must(id); await this.audit(actor.sub, 'withdraw', out, { from: row.status }); return out;
  }
}
