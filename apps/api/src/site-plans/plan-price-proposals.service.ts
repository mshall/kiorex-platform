import { Injectable, Logger } from '@nestjs/common';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../common/errors';
import { newId } from '../common/ids';
import type { AuthUser } from '../common/auth';
import { PrismaService } from '../prisma/prisma.service';
import { catalogueWarnings, priceWarnings, type PriceInterval, type PriceProduct, type PriceRow, type PriceWarning } from './price-checks';
import { parsePriceInput, type PriceInput } from './price-input';
import { ProductPlansClient, type ProductKind, type ProductPlansOverview } from './product-plans.client';
import { SitePlansService } from './site-plans.service';

const EDITION_ORDER: Record<string, number> = { LITE: 10, PRO: 20, CHAIN: 30 };
const ROLES_PROPOSE = ['ops_admin', 'super_admin'];
const ID = /^kpp_[a-z0-9]{6,64}$/;
const STATUSES = ['PENDING', 'APPROVED', 'REJECTED', 'WITHDRAWN'];

interface ClinicPlan { id: string; key: string; nameEn: string; nameAr: string; sortOrder: number; prices: any[] }
interface ClinicState { markets: Array<{ id: string; code: string; defaultCurrency: string }>; plans: ClinicPlan[] }
export interface Catalogue {
  product: PriceProduct;
  plans: Array<{ ref: string; key: string; order: number }>;
  markets: Array<{ code: string; ref: string | null; currency: string | null }>;
  rows: PriceRow[];
  organisations: Array<{ planKey: string; market: string; count: number }>;
  raw: ClinicState | ProductPlansOverview;
}
export interface PreviewResult { priceVersion: number; supersedes: boolean; validFrom: string; affected: number; mrrDelta: string | null; from: { amount: string; currency: string; priceVersion: number } | null }

const actorOf = (u: AuthUser) => ({ id: u.sub, ...(u.email ? { email: u.email.slice(0, 200) } : {}) });
const isOps = (u: AuthUser) => u.roles.some((r) => ROLES_PROPOSE.includes(r));

/**
 * Maker-checker for plan prices of the Clinic, the Pharmacy and the Lab. Kiorly ops (ops_admin) or a super admin PROPOSES a version; a DIFFERENT super admin APPROVES it,
 * and only then does this service publish it through the product's signed route (the product owns the price rows). Everything is audited (`kiorly.plans.price_*`), a rejected or
 * withdrawn proposal stays in the history (append-only table, trigger and CHECKs), the start is effective-dated and previewed, and the advisory checks warn without blocking.
 * No price is ever created, defaulted or seeded by this code.
 */
@Injectable()
export class PlanPriceProposalService {
  private readonly log = new Logger('plan-price-proposals');
  constructor(private readonly prisma: PrismaService, private readonly sitePlans: SitePlansService, private readonly products: ProductPlansClient) {}

  // ───────────── catalogue (what each product holds today) ─────────────

  async catalogue(product: PriceProduct): Promise<Catalogue> {
    if (product === 'CLINIC') {
      const c = await this.sitePlans.call<ClinicState>('GET', '/plans');
      return this.fromClinic(c);
    }
    const o = await this.products.overview(product);
    return this.fromProduct(product, o);
  }

  fromClinic(c: ClinicState): Catalogue {
    const code = (id: string) => c.markets.find((m) => m.id === id)?.code ?? id;
    return {
      product: 'CLINIC',
      plans: c.plans.map((p) => ({ ref: p.id, key: p.key, order: p.sortOrder })),
      markets: c.markets.map((m) => ({ code: m.code, ref: m.id, currency: m.defaultCurrency })),
      rows: c.plans.flatMap((p) => (p.prices ?? []).map((x): PriceRow => ({ product: 'CLINIC', planKey: p.key, planOrder: p.sortOrder, market: code(x.marketId), interval: x.interval, unit: x.unit, amount: String(x.amount), currency: x.currency, validFrom: new Date(x.validFrom), validTo: x.validTo ? new Date(x.validTo) : null, cohortKey: x.cohortKey ?? null }))),
      organisations: [],
      raw: c,
    };
  }

  fromProduct(product: ProductKind, o: ProductPlansOverview): Catalogue {
    return {
      product,
      plans: o.editions.map((e) => ({ ref: e, key: e, order: EDITION_ORDER[e] ?? 99 })),
      markets: [],
      rows: o.prices.map((x): PriceRow => ({ product, planKey: x.edition, planOrder: EDITION_ORDER[x.edition] ?? 99, market: x.marketCode, interval: x.interval as PriceInterval, unit: 'PER_TENANT', amount: x.amount, currency: x.currency, validFrom: new Date(x.validFrom), validTo: x.validTo ? new Date(x.validTo) : null })),
      organisations: o.organisations.map((x) => ({ planKey: x.edition, market: x.marketCode, count: x.count })),
      raw: o,
    };
  }

  invalidate() { this.products.invalidate(); }

  // ───────────── overview extras for the console ─────────────

  async extras(u: AuthUser, clinic: { available: boolean; markets?: unknown[]; plans?: unknown[] }) {
    const mine = (kind: ProductKind) => this.products.configured()
      ? this.products.overview(kind).then((o) => ({ available: true as const, configured: true as const, ...o })).catch((e) => ({ available: false as const, configured: true as const, code: e instanceof ApiError ? e.code : 'ERROR', editions: [] as string[], prices: [] as unknown[], organisations: [] as unknown[] }))
      : Promise.resolve({ available: false as const, configured: false as const, code: 'PRODUCT_PRICES_NOT_CONFIGURED', editions: [] as string[], prices: [] as unknown[], organisations: [] as unknown[] });
    const [pharmacy, lab, proposals] = await Promise.all([mine('PHARMACY'), mine('LAB'), this.list(u, {})]);
    const rows: PriceRow[] = [];
    if (clinic.available) rows.push(...this.fromClinic({ markets: (clinic.markets ?? []) as ClinicState['markets'], plans: (clinic.plans ?? []) as ClinicPlan[] }).rows);
    if (pharmacy.available) rows.push(...this.fromProduct('PHARMACY', pharmacy as unknown as ProductPlansOverview).rows);
    if (lab.available) rows.push(...this.fromProduct('LAB', lab as unknown as ProductPlansOverview).rows);
    return {
      pharmacy, lab, proposals,
      capabilities: { canPropose: isOps(u), canApprove: u.roles.includes('super_admin'), you: u.sub },
      catalogueWarnings: catalogueWarnings(rows),
    };
  }

  // ───────────── preview and propose ─────────────

  private audit(u: AuthUser, action: string, id: string | undefined, meta: Record<string, unknown>) {
    return this.prisma.auditLog.create({ data: { actor: u.sub, action: `kiorly.plans.${action}`, resource: 'KiorlyPlanPriceProposal', resourceId: id, metadata: meta as never } }).catch(() => undefined);
  }

  /** Resolves the plan and the market against what the product holds. A Clinic price needs a market the Clinic knows; Pharmacy and Lab warn only (an unlaunched market is harmless, nothing sits on it). */
  private resolve(input: PriceInput, cat: Catalogue) {
    const plan = cat.plans.find((p) => (input.product === 'CLINIC' ? p.ref === input.planRef : p.key === input.planRef));
    if (!plan) throw badRequest('PLAN_NOT_FOUND', 'That plan does not exist in the product');
    const market = cat.markets.find((m) => m.code === input.marketCode) ?? null;
    if (input.product === 'CLINIC' && !market) throw badRequest('UNKNOWN_MARKET', 'The Clinic does not know that market');
    return { plan, market };
  }

  private async productPreview(u: AuthUser, input: PriceInput, cat: Catalogue, from: Date | null): Promise<PreviewResult> {
    const { plan, market } = this.resolve(input, cat);
    const at = from ?? new Date();
    if (input.product === 'CLINIC') {
      const r = await this.sitePlans.call<{ priceVersion: number; supersedes: boolean; impact: { tenantsAffected: number; mrrDelta: string } | null }>('POST', `/plans/${plan.ref}/prices`, {
        marketId: market!.ref, currency: input.currency, interval: input.interval, unit: input.unit, amount: input.amount, includedClinicians: input.includedClinicians ?? 1,
        ...(input.extraClinicianAmount ? { extraClinicianAmount: input.extraClinicianAmount } : {}), ...(from ? { validFrom: from.toISOString() } : {}), preview: true, actor: actorOf(u),
      });
      const cur = cat.rows.find((x) => x.planKey === plan.key && x.market === input.marketCode && x.interval === input.interval && x.unit === input.unit && !x.cohortKey && x.validFrom <= at && (!x.validTo || x.validTo > at));
      return { priceVersion: r.priceVersion, supersedes: r.supersedes, validFrom: at.toISOString(), affected: r.impact?.tenantsAffected ?? 0, mrrDelta: r.impact?.mrrDelta ?? null, from: cur ? { amount: cur.amount, currency: cur.currency, priceVersion: 0 } : null };
    }
    const r = await this.products.price<{ priceVersion: number; supersedes: boolean; validFrom: string; impact: { organisationsAffected: number; from: { amount: string; currency: string; priceVersion: number } | null } }>(input.product, {
      edition: plan.key, marketCode: input.marketCode, interval: input.interval, currency: input.currency, amount: input.amount, ...(from ? { validFrom: from.toISOString() } : {}), preview: true, actor: actorOf(u),
    });
    return { priceVersion: r.priceVersion, supersedes: r.supersedes, validFrom: r.validFrom, affected: r.impact.organisationsAffected, mrrDelta: null, from: r.impact.from };
  }

  private warningsFor(input: PriceInput, cat: Catalogue, from: Date | null): PriceWarning[] {
    const plan = cat.plans.find((p) => (input.product === 'CLINIC' ? p.ref === input.planRef : p.key === input.planRef))!;
    return priceWarnings({ product: input.product, planKey: plan.key, planOrder: plan.order, market: input.marketCode, interval: input.interval, unit: input.unit, amount: input.amount, currency: input.currency, effectiveFrom: from ?? new Date() }, cat.rows);
  }

  async preview(u: AuthUser, body: unknown) {
    if (!isOps(u)) throw forbidden('FORBIDDEN', 'Not allowed');
    const input = parsePriceInput(body);
    const cat = await this.catalogue(input.product);
    this.resolve(input, cat);
    const result = await this.productPreview(u, input, cat, input.validFrom);
    const warnings = this.warningsFor(input, cat, input.validFrom);
    await this.audit(u, 'price_preview', undefined, { product: input.product, planRef: input.planRef, marketCode: input.marketCode, interval: input.interval, amount: input.amount, currency: input.currency, warnings: warnings.map((x) => x.code) });
    return { input: { ...input, validFrom: input.validFrom?.toISOString() ?? null }, preview: result, warnings };
  }

  async propose(u: AuthUser, body: unknown) {
    if (!isOps(u)) throw forbidden('FORBIDDEN', 'Only Kiorly ops or a super admin may propose a price');
    const input = parsePriceInput(body);
    const cat = await this.catalogue(input.product);
    const { plan, market } = this.resolve(input, cat);
    const preview = await this.productPreview(u, input, cat, input.validFrom);
    const warnings = this.warningsFor(input, cat, input.validFrom);
    const id = newId('kpp').toLowerCase();
    try {
      const row = await this.prisma.kiorlyPlanPriceProposal.create({
        data: {
          id, product: input.product, planRef: plan.ref, planKey: plan.key, marketCode: input.marketCode, marketRef: market?.ref ?? null, interval: input.interval, unit: input.unit, currency: input.currency, amount: input.amount,
          includedClinicians: input.includedClinicians, extraClinicianAmount: input.extraClinicianAmount, effectiveFrom: input.validFrom ?? new Date(preview.validFrom), note: input.note,
          warnings: warnings as never, preview: preview as never, proposedBy: u.sub, proposedByEmail: u.email?.slice(0, 200) ?? null,
        },
      });
      await this.audit(u, 'price_proposed', id, { product: input.product, planKey: plan.key, marketCode: input.marketCode, interval: input.interval, unit: input.unit, amount: input.amount, currency: input.currency, effectiveFrom: row.effectiveFrom, warnings: warnings.map((x) => x.code) });
      return this.view(row);
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002') throw conflict('PROPOSAL_PENDING', 'A proposal for this plan, market and period is already waiting for a decision: decide or withdraw it first');
      throw e;
    }
  }

  // ───────────── decide ─────────────

  async withdraw(u: AuthUser, id: string) {
    const row = await this.get(id);
    if (row.proposedBy !== u.sub) throw forbidden('NOT_YOUR_PROPOSAL', 'Only the person who proposed a price can withdraw it');
    const c = await this.prisma.kiorlyPlanPriceProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'WITHDRAWN', decidedBy: u.sub, decidedAt: new Date() } });
    if (c.count !== 1) throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
    await this.audit(u, 'price_withdrawn', id, { product: row.product, planKey: row.planKey, marketCode: row.marketCode, interval: row.interval });
    return this.view(await this.get(id));
  }

  async reject(u: AuthUser, id: string, noteRaw?: unknown) {
    if (!u.roles.includes('super_admin')) throw forbidden('FORBIDDEN', 'Only a super admin decides a price');
    const row = await this.get(id);
    if (row.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
    if (row.proposedBy === u.sub) throw forbidden('TWO_PERSON_RULE', 'A different super admin must decide this proposal (maker-checker); you can withdraw your own');
    const note = typeof noteRaw === 'string' ? noteRaw.trim().slice(0, 300) || null : null;
    const c = await this.prisma.kiorlyPlanPriceProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', decidedBy: u.sub, decidedAt: new Date(), decisionNote: note } });
    if (c.count !== 1) throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
    await this.audit(u, 'price_rejected', id, { product: row.product, planKey: row.planKey, marketCode: row.marketCode, interval: row.interval, proposedBy: row.proposedBy });
    return this.view(await this.get(id));
  }

  /** Approve and publish. The product publish is idempotent per proposal (Pharmacy, Lab) or adopted when the same version already exists (Clinic), so a retry after a timeout never doubles a version. */
  async approve(u: AuthUser, id: string, noteRaw?: unknown) {
    if (!u.roles.includes('super_admin')) throw forbidden('FORBIDDEN', 'Only a super admin decides a price');
    const row = await this.get(id);
    if (row.status !== 'PENDING') throw conflict('ALREADY_DECIDED', 'This proposal was already decided');
    if (row.proposedBy === u.sub) throw forbidden('TWO_PERSON_RULE', 'A different super admin must approve this proposal (maker-checker); you can withdraw your own');
    const note = typeof noteRaw === 'string' ? noteRaw.trim().slice(0, 300) || null : null;
    const now = new Date();
    const from = row.publishedValidFrom ?? (row.effectiveFrom > now ? row.effectiveFrom : now);
    if (!row.publishedValidFrom) await this.prisma.kiorlyPlanPriceProposal.updateMany({ where: { id, status: 'PENDING' }, data: { publishedValidFrom: from, lastAttemptAt: now } });
    const product = row.product as PriceProduct;
    let published: { priceVersion: number; validFrom: Date };
    try {
      published = await this.publish(u, row, from);
    } catch (e) {
      const code = e instanceof ApiError ? e.code : 'ERROR';
      await this.prisma.kiorlyPlanPriceProposal.updateMany({ where: { id, status: 'PENDING' }, data: { lastError: code, lastAttemptAt: new Date() } });
      await this.audit(u, 'price_publish_refused', id, { product, planKey: row.planKey, marketCode: row.marketCode, interval: row.interval, code });
      throw e;
    }
    const moved = published.validFrom.getTime() !== row.effectiveFrom.getTime();
    const c = await this.prisma.kiorlyPlanPriceProposal.updateMany({
      where: { id, status: 'PENDING' },
      data: { status: 'APPROVED', decidedBy: u.sub, decidedAt: new Date(), decisionNote: note, publishedVersion: published.priceVersion, lastError: null, effectiveFrom: published.validFrom, ...(moved ? { requestedFrom: row.effectiveFrom } : {}) },
    });
    if (c.count !== 1) throw conflict('ALREADY_DECIDED', 'This proposal was decided at the same time; the price is published once');
    this.invalidate(); this.sitePlans.invalidate();
    await this.audit(u, 'price_approved', id, { product, planKey: row.planKey, marketCode: row.marketCode, interval: row.interval, unit: row.unit, amount: row.amount, currency: row.currency, priceVersion: published.priceVersion, effectiveFrom: published.validFrom, proposedBy: row.proposedBy });
    return this.view(await this.get(id));
  }

  private async publish(u: AuthUser, row: Awaited<ReturnType<PlanPriceProposalService['get']>>, from: Date): Promise<{ priceVersion: number; validFrom: Date }> {
    const approval = { proposalId: row.id, proposedBy: row.proposedBy };
    if (row.product === 'CLINIC') {
      const cat = await this.catalogue('CLINIC');
      const same = cat.rows.find((x) => x.planKey === row.planKey && x.market === row.marketCode && x.interval === row.interval && x.unit === row.unit && !x.cohortKey && x.validFrom.getTime() === from.getTime() && cents(x.amount) === cents(row.amount));
      if (same) { // an earlier attempt published it and only the local record is missing
        const c = (cat.raw as ClinicState).plans.find((p) => p.id === row.planRef)?.prices.find((p) => new Date(p.validFrom).getTime() === from.getTime() && !p.cohortKey && p.interval === row.interval && p.unit === row.unit && cents(String(p.amount)) === cents(row.amount));
        return { priceVersion: Number(c?.priceVersion ?? 0), validFrom: from };
      }
      const r = await this.sitePlans.call<{ priceVersion: number; validFrom: string }>('POST', `/plans/${row.planRef}/prices`, {
        marketId: row.marketRef, currency: row.currency, interval: row.interval, unit: row.unit, amount: row.amount, includedClinicians: row.includedClinicians ?? 1,
        ...(row.extraClinicianAmount ? { extraClinicianAmount: row.extraClinicianAmount } : {}), validFrom: from.toISOString(), approval, actor: actorOf(u),
      });
      return { priceVersion: r.priceVersion, validFrom: new Date(r.validFrom) };
    }
    const r = await this.products.price<{ price: { priceVersion: number; validFrom: string } }>(row.product as ProductKind, { edition: row.planKey, marketCode: row.marketCode, interval: row.interval, currency: row.currency, amount: row.amount, validFrom: from.toISOString(), approval, actor: actorOf(u) });
    return { priceVersion: r.price.priceVersion, validFrom: new Date(r.price.validFrom) };
  }

  // ───────────── reads ─────────────

  private async get(id: string) {
    if (!ID.test(id)) throw badRequest('INVALID_ID', 'Invalid identifier');
    const row = await this.prisma.kiorlyPlanPriceProposal.findUnique({ where: { id } });
    if (!row) throw notFound('PROPOSAL_NOT_FOUND', 'No such proposal');
    return row;
  }

  async list(u: AuthUser, q: { status?: string; product?: string }) {
    if (!isOps(u)) throw forbidden('FORBIDDEN', 'Not allowed');
    const where: Record<string, unknown> = {};
    if (q.status && STATUSES.includes(q.status.toUpperCase())) where.status = q.status.toUpperCase();
    if (q.product && ['CLINIC', 'PHARMACY', 'LAB'].includes(q.product.toUpperCase())) where.product = q.product.toUpperCase();
    const rows = await this.prisma.kiorlyPlanPriceProposal.findMany({ where, orderBy: { proposedAt: 'desc' }, take: 200 });
    return rows.map((r) => this.view(r));
  }

  private view(r: Awaited<ReturnType<PlanPriceProposalService['get']>>) {
    return {
      id: r.id, product: r.product, planRef: r.planRef, planKey: r.planKey, marketCode: r.marketCode, interval: r.interval, unit: r.unit, currency: r.currency, amount: r.amount,
      includedClinicians: r.includedClinicians, extraClinicianAmount: r.extraClinicianAmount, effectiveFrom: r.effectiveFrom, requestedFrom: r.requestedFrom, note: r.note, status: r.status,
      warnings: r.warnings, preview: r.preview, proposedBy: r.proposedBy, proposedByEmail: r.proposedByEmail, proposedAt: r.proposedAt, decidedBy: r.decidedBy, decidedAt: r.decidedAt, decisionNote: r.decisionNote,
      publishedVersion: r.publishedVersion, lastError: r.lastError, lastAttemptAt: r.lastAttemptAt,
    };
  }
}

const cents = (a: string): number => { const [w, f = ''] = a.trim().split('.'); return Number(w) * 100 + Number((f + '00').slice(0, 2)); };
