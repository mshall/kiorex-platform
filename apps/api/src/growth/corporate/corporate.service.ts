import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { CORPORATE_FLAG, GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { CorporateConfigService } from './corporate-config';
import { generateCode, hashCode, normaliseCode } from './corporate-code';
import { CorporateEventsService } from './corporate-events.service';
import { looksPersonal } from './corporate-privacy';

export const MAX_MINOR = 2_000_000_000;
export interface Actor { sub: string; roles: string[] }
export interface CreateAccountInput { displayName: string; market?: string; fundingMode?: 'SPONSOR_CREDIT' | 'PLATFORM_PROMO'; legalNameRef?: string; billingContactRef?: string; leadId?: string }
export interface TermsInput { contractRef?: string | null; sponsorCeilingMinor?: number | null; perMemberCapMinor?: number | null; perVisitMaxMinor?: number | null; coverBp?: number | null; startsAt?: string | null; endsAt?: string | null; emailDomains?: string[]; fundingMode?: 'SPONSOR_CREDIT' | 'PLATFORM_PROMO'; billingContactRef?: string | null }

const cleanDomain = (d: string) => d.trim().toLowerCase().replace(/^@/, '');
const DOMAIN_RE = /^(?=.{4,100}$)([a-z0-9-]+\.)+[a-z]{2,}$/;

/**
 * Corporate accounts, codes and invoice notes (GRW-P4-C). Company data only. Ops writes; every write is an AuditLog row with the actor and no personal data.
 * Money terms (ceiling, per-member cap, per-visit maximum, cover share, funding mode, contract reference) are entered after a signed contract and are NEEDS_HUMAN: they are null until then and the database
 * refuses to activate an account without them. Activation is a two-person act: the person who last edited the terms cannot activate (also a CHECK in the database).
 * While ACTIVE the terms are frozen: pause first, edit, and a second person activates again.
 */
@Injectable()
export class CorporateService {
  constructor(private readonly prisma: PrismaService, private readonly events: CorporateEventsService, private readonly config: CorporateConfigService, private readonly flags: FlagsService) {}

  private async audit(actor: string, action: string, id: string, metadata: Record<string, unknown> = {}) {
    await this.prisma.auditLog.create({ data: { actor, action: `growth.corporate.${action}`, resource: 'CorporateAccount', resourceId: id, metadata: metadata as Prisma.InputJsonValue } });
  }
  private async load(id: string) { const a = await this.prisma.corporateAccount.findUnique({ where: { id } }); if (!a) throw notFound('CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found'); return a; }

  async create(actor: Actor, i: CreateAccountInput) {
    const name = i.displayName?.trim();
    if (!name || name.length < 2 || name.length > 120) throw badRequest('INVALID_INPUT', 'displayName must be 2..120 characters');
    if (looksPersonal(name) || looksPersonal(i.legalNameRef ?? '') || looksPersonal(i.billingContactRef ?? '')) throw unprocessable('CORPORATE_PERSONAL_DATA', 'Accounts hold company data only: use an opaque reference, never a name, phone or e-mail of a person');
    const policy = await this.config.get(i.market ?? GROWTH_DEFAULT_MARKET);
    const a = await this.prisma.$transaction(async (tx) => {
      const row = await tx.corporateAccount.create({ data: { market: i.market ?? GROWTH_DEFAULT_MARKET, displayName: name, legalNameRef: i.legalNameRef ?? null, billingContactRef: i.billingContactRef ?? null, fundingMode: i.fundingMode ?? policy.fundingMode, createdBy: actor.sub } });
      await this.events.emit(tx, 'CorporateAccountCreated', row.id, { accountRef: row.id, market: row.market, fundingMode: row.fundingMode, createdAt: row.createdAt.toISOString() }, row.id);
      if (i.leadId) {
        const lead = await tx.corporateLead.findUnique({ where: { id: i.leadId } });
        if (lead && !lead.accountId) { await tx.corporateLead.update({ where: { id: lead.id }, data: { accountId: row.id } }); }
      }
      return row;
    });
    await this.audit(actor.sub, 'account_created', a.id, { market: a.market, fundingMode: a.fundingMode });
    return this.view(a);
  }

  async updateTerms(actor: Actor, id: string, t: TermsInput) {
    const a = await this.load(id);
    if (a.status === 'ACTIVE' || a.status === 'ENDED') throw conflict('CORPORATE_TERMS_FROZEN', `Terms cannot be edited while the account is ${a.status}: pause it first`);
    const data: Prisma.CorporateAccountUpdateInput = {};
    const money = (k: 'sponsorCeilingMinor' | 'perMemberCapMinor' | 'perVisitMaxMinor') => { const v = t[k]; if (v === undefined) return; if (v !== null && (!Number.isInteger(v) || v < 0 || v > MAX_MINOR)) throw badRequest('INVALID_INPUT', `${k} must be an integer from 0 to ${MAX_MINOR}`); data[k] = v; };
    money('sponsorCeilingMinor'); money('perMemberCapMinor'); money('perVisitMaxMinor');
    if (t.coverBp !== undefined) { if (t.coverBp !== null && (!Number.isInteger(t.coverBp) || t.coverBp < 1 || t.coverBp > 10000)) throw badRequest('INVALID_INPUT', 'coverBp must be 1..10000'); data.coverBp = t.coverBp; }
    if (t.contractRef !== undefined) { if (t.contractRef !== null && (t.contractRef.length > 120 || looksPersonal(t.contractRef))) throw badRequest('INVALID_INPUT', 'contractRef must be an opaque reference of at most 120 characters'); data.contractRef = t.contractRef; }
    if (t.billingContactRef !== undefined) { if (t.billingContactRef !== null && (t.billingContactRef.length > 120 || looksPersonal(t.billingContactRef))) throw badRequest('INVALID_INPUT', 'billingContactRef must be an opaque reference'); data.billingContactRef = t.billingContactRef; }
    if (t.fundingMode) data.fundingMode = t.fundingMode;
    for (const k of ['startsAt', 'endsAt'] as const) if (t[k] !== undefined) { const d = t[k] === null ? null : new Date(t[k] as string); if (d && Number.isNaN(d.getTime())) throw badRequest('INVALID_INPUT', `${k} is not a date`); data[k] = d; }
    if (t.emailDomains) {
      const ds = t.emailDomains.map(cleanDomain);
      if (ds.length > 20 || ds.some((d) => !DOMAIN_RE.test(d))) throw badRequest('INVALID_INPUT', 'emailDomains must be at most 20 valid domains');
      data.emailDomains = [...new Set(ds)];
    }
    const cap = (data.perMemberCapMinor ?? a.perMemberCapMinor) as number | null; const ceil = (data.sponsorCeilingMinor ?? a.sponsorCeilingMinor) as number | null;
    if (cap != null && ceil != null && cap > ceil) throw unprocessable('CORPORATE_TERMS_INCOMPLETE', 'The per-member cap cannot exceed the sponsor ceiling');
    const s = (data.startsAt ?? a.startsAt) as Date | null; const e = (data.endsAt ?? a.endsAt) as Date | null;
    if (s && e && e <= s) throw unprocessable('CORPORATE_TERMS_INCOMPLETE', 'endsAt must be after startsAt');
    data.termsEditedBy = actor.sub; data.termsEditedAt = new Date();
    const u = await this.prisma.corporateAccount.update({ where: { id }, data });
    await this.audit(actor.sub, 'terms_edited', id, { fields: Object.keys(t) });
    return this.view(u);
  }

  /** LEAD or PAUSED -> ACTIVE. Not by the person who last edited the terms; terms must be complete; an end date in the future is required (the benefit expires with the contract). */
  async activate(actor: Actor, id: string, now = new Date()) {
    const a = await this.load(id);
    if (a.status !== 'LEAD' && a.status !== 'PAUSED') throw conflict('CORPORATE_ACCOUNT_NOT_ACTIVE', `Only a LEAD or PAUSED account can be activated (it is ${a.status})`);
    if (a.termsEditedBy && a.termsEditedBy === actor.sub) throw forbidden('CORPORATE_SELF_APPROVAL', 'A second person must activate: you edited the terms');
    const missing = [!a.contractRef && 'contractRef', !a.sponsorCeilingMinor && 'sponsorCeilingMinor', !a.perMemberCapMinor && 'perMemberCapMinor', !a.coverBp && 'coverBp', !a.endsAt && 'endsAt'].filter(Boolean);
    if (missing.length) throw unprocessable('CORPORATE_TERMS_INCOMPLETE', `Terms are incomplete: ${missing.join(', ')} (set after the signed contract; not defaulted)`, { missing });
    if (a.endsAt! <= now) throw unprocessable('CORPORATE_TERMS_INCOMPLETE', 'endsAt is in the past');
    if (!(await this.flags.isEnabled(CORPORATE_FLAG, { market: a.market }).catch(() => false))) throw forbidden('FEATURE_DISABLED', 'growth.corporate is OFF (launch-locked)', { key: CORPORATE_FLAG, scope: 'market' });
    const u = await this.prisma.corporateAccount.update({ where: { id }, data: { status: 'ACTIVE', activatedBy: actor.sub, activatedAt: now } });
    await this.audit(actor.sub, 'activated', id);
    return this.view(u);
  }

  async pause(actor: Actor, id: string) {
    const a = await this.load(id);
    if (a.status !== 'ACTIVE') throw conflict('CORPORATE_ACCOUNT_NOT_ACTIVE', `Only an ACTIVE account can be paused (it is ${a.status})`);
    const u = await this.prisma.corporateAccount.update({ where: { id }, data: { status: 'PAUSED' } });
    await this.audit(actor.sub, 'paused', id);
    return this.view(u);
  }

  /** ENDED is final: members' eligibility ends (history stays), codes are revoked, holds are left to settle. */
  async end(actor: Actor, id: string, now = new Date()) {
    const a = await this.load(id);
    if (a.status === 'ENDED') return this.view(a);
    const u = await this.prisma.$transaction(async (tx) => {
      const row = await tx.corporateAccount.update({ where: { id }, data: { status: 'ENDED', endsAt: a.endsAt && a.endsAt < now ? a.endsAt : now } });
      await tx.corporateMember.updateMany({ where: { accountId: id, endedAt: null }, data: { endedAt: now, endReason: 'ACCOUNT_ENDED' } });
      await tx.corporateCode.updateMany({ where: { accountId: id, status: 'ACTIVE' }, data: { status: 'REVOKED' } });
      return row;
    });
    await this.audit(actor.sub, 'ended', id);
    return this.view(u);
  }

  async list(q: { status?: string; market?: string; take?: number } = {}) {
    const rows = await this.prisma.corporateAccount.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.market ? { market: q.market } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(q.take ?? 100, 1), 200) });
    return { items: rows.map((r) => this.view(r)) };
  }
  async get(id: string) { return this.view(await this.load(id)); }

  private view(a: Prisma.CorporateAccountGetPayload<object>) {
    return {
      id: a.id, market: a.market, displayName: a.displayName, status: a.status, fundingMode: a.fundingMode, currency: a.currency, contractRef: a.contractRef, legalNameRef: a.legalNameRef, billingContactRef: a.billingContactRef,
      startsAt: a.startsAt?.toISOString() ?? null, endsAt: a.endsAt?.toISOString() ?? null, emailDomains: a.emailDomains,
      terms: { sponsorCeilingMinor: a.sponsorCeilingMinor, perMemberCapMinor: a.perMemberCapMinor, perVisitMaxMinor: a.perVisitMaxMinor, coverBp: a.coverBp, complete: !!(a.contractRef && a.sponsorCeilingMinor && a.perMemberCapMinor && a.coverBp && a.endsAt) },
      termsEditedBy: a.termsEditedBy, activatedBy: a.activatedBy, createdAt: a.createdAt.toISOString(),
    };
  }

  // ── codes ──
  /** The plain code is returned ONCE here and never again (only its keyed hash is stored). */
  async createCode(actor: Actor, accountId: string, i: { label: string; kind?: 'OPEN' | 'LIST'; maxRedemptions: number; perMemberCapMinor?: number | null; expiresAt?: string | null }) {
    const a = await this.load(accountId);
    if (a.status === 'ENDED') throw conflict('CORPORATE_ACCOUNT_NOT_ACTIVE', 'The account has ended');
    const label = i.label?.trim();
    if (!label || label.length > 80 || looksPersonal(label)) throw badRequest('INVALID_INPUT', 'label must be 1..80 characters and not contain a person\'s contact data');
    if (!Number.isInteger(i.maxRedemptions) || i.maxRedemptions < 1 || i.maxRedemptions > 100000) throw badRequest('INVALID_INPUT', 'maxRedemptions must be 1..100000');
    if (i.perMemberCapMinor != null && (!Number.isInteger(i.perMemberCapMinor) || i.perMemberCapMinor < 1 || i.perMemberCapMinor > (a.perMemberCapMinor ?? MAX_MINOR))) throw badRequest('INVALID_INPUT', 'perMemberCapMinor must be positive and not above the account cap');
    const exp = i.expiresAt ? new Date(i.expiresAt) : null; if (exp && Number.isNaN(exp.getTime())) throw badRequest('INVALID_INPUT', 'expiresAt is not a date');
    const policy = await this.config.get(a.market);
    for (let attempt = 0; attempt < 5; attempt++) {
      const plain = generateCode(policy.codeFormat); const norm = normaliseCode(plain)!;
      try {
        const row = await this.prisma.corporateCode.create({ data: { accountId, codeHash: hashCode(norm), label, kind: i.kind ?? 'OPEN', maxRedemptions: i.maxRedemptions, perMemberCapMinor: i.perMemberCapMinor ?? null, expiresAt: exp, createdBy: actor.sub } });
        await this.audit(actor.sub, 'code_created', accountId, { codeId: row.id, kind: row.kind, maxRedemptions: row.maxRedemptions });
        return { id: row.id, code: plain, label: row.label, kind: row.kind, maxRedemptions: row.maxRedemptions, expiresAt: row.expiresAt?.toISOString() ?? null, shownOnce: true };
      } catch (e) { if (!/Unique constraint/.test((e as Error).message)) throw e; }
    }
    throw conflict('CORPORATE_CODE_COLLISION', 'Could not generate a unique code, try again');
  }

  async revokeCode(actor: Actor, accountId: string, codeId: string) {
    const c = await this.prisma.corporateCode.findFirst({ where: { id: codeId, accountId } });
    if (!c) throw notFound('CORPORATE_CODE_NOT_FOUND', 'Code not found');
    await this.prisma.corporateCode.update({ where: { id: codeId }, data: { status: 'REVOKED' } });
    await this.audit(actor.sub, 'code_revoked', accountId, { codeId });
    return { id: codeId, status: 'REVOKED' };
  }

  /** Codes never expose the plain value or the hash: label, kind, counters and the derived state only. */
  async listCodes(accountId: string, now = new Date()) {
    await this.load(accountId);
    const rows = await this.prisma.corporateCode.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 200 });
    return { items: rows.map((c) => ({ id: c.id, label: c.label, kind: c.kind, maxRedemptions: c.maxRedemptions, redeemedCount: c.redeemedCount, perMemberCapMinor: c.perMemberCapMinor, expiresAt: c.expiresAt?.toISOString() ?? null, status: c.status !== 'ACTIVE' ? c.status : c.expiresAt && c.expiresAt <= now ? 'EXPIRED' : c.redeemedCount >= c.maxRedemptions ? 'EXHAUSTED' : 'ACTIVE', createdAt: c.createdAt.toISOString() })) };
  }

  // ── manual invoicing support (no billing engine) ──
  async invoiceNote(actor: Actor, accountId: string, i: { month: string; notes?: string }) {
    await this.load(accountId);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(i.month)) throw badRequest('INVALID_INPUT', 'month must be YYYY-MM');
    if ((i.notes ?? '').length > 1000 || looksPersonal(i.notes ?? '')) throw badRequest('INVALID_INPUT', 'notes describe the company and the invoice only (at most 1000 characters, no personal contact data)');
    const [y, m] = i.month.split('-').map(Number);
    const from = new Date(Date.UTC(y, m - 1, 1)); const to = new Date(Date.UTC(y, m, 1));
    const rows = await this.prisma.$queryRaw<{ s: bigint | null }[]>(Prisma.sql`SELECT sum(CASE "type" WHEN 'REDEEM' THEN "amountMinor" WHEN 'REVERSE' THEN -"amountMinor" END) AS s FROM "CorporateBenefitEntry" WHERE "accountId" = ${accountId} AND "type" IN ('REDEEM','REVERSE') AND "createdAt" >= ${from} AND "createdAt" < ${to}`);
    const spend = Math.max(0, Number(rows[0]?.s ?? 0n));
    try {
      const n = await this.prisma.corporateInvoiceNote.create({ data: { accountId, month: i.month, sponsorSpendMinor: spend, notes: i.notes ?? '', createdBy: actor.sub } });
      await this.audit(actor.sub, 'invoice_note', accountId, { month: i.month, sponsorSpendMinor: spend });
      return { id: n.id, month: n.month, sponsorSpendMinor: n.sponsorSpendMinor, notes: n.notes };
    } catch (e) { if (/Unique constraint/.test((e as Error).message)) throw conflict('CORPORATE_INVOICE_NOTE_EXISTS', 'A note for this month already exists'); throw e; }
  }
  async invoiceNotes(accountId: string) {
    await this.load(accountId);
    return { items: (await this.prisma.corporateInvoiceNote.findMany({ where: { accountId }, orderBy: { month: 'desc' }, take: 60 })).map((n) => ({ id: n.id, month: n.month, sponsorSpendMinor: n.sponsorSpendMinor, notes: n.notes, createdAt: n.createdAt.toISOString() })) };
  }
}
