import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { badRequest, conflict, notFound, unprocessable } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { looksPersonal } from './corporate-privacy';
import type { Actor } from './corporate.service';

export const LEAD_TRANSITIONS: Record<string, readonly string[]> = {
  NEW: ['CONTACTED', 'DUPLICATE', 'LOST'], CONTACTED: ['QUALIFIED', 'LOST'], QUALIFIED: ['PROPOSAL', 'LOST'], PROPOSAL: ['WON', 'LOST'], LOST: ['CONTACTED'], WON: [], DUPLICATE: [],
};
export const SIZE_BUCKETS = ['1_49', '50_199', '200_999', '1000_PLUS', 'UNKNOWN'] as const;
const norm = (s: string) => s.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();

/**
 * The enterprise lead pipeline for ops (GRW-P4-C): leads that a provider referred through the Clinic (`CorporateLeadReferred`), inbound requests and outbound prospects.
 * COMPANY data only: the company name, a size bucket and an opaque contact reference. A staff member's name, phone or e-mail is refused, never stored. B2B leads are not patient attribution and create no reward,
 * credit or fee share for the referring provider (any fee share is counsel and CEO gated, NEEDS_HUMAN). The ingest is idempotent on the Clinic's referral id and works with the flag OFF (a lead is not a benefit).
 */
@Injectable()
export class B2bReferralService {
  constructor(private readonly prisma: PrismaService) {}

  /** The signed webhook: returns APPLIED, or IGNORED for a payload that is not a company lead. A repeat of the same referral id is APPLIED without a second row. */
  async ingestFromClinic(data: Record<string, any>): Promise<'APPLIED' | 'IGNORED'> {
    const ref = typeof data.referralId === 'string' ? data.referralId : '';
    const name = typeof data.companyName === 'string' ? data.companyName.trim() : '';
    if (!ref || name.length < 2 || name.length > 120 || looksPersonal(name)) return 'IGNORED';
    const orgRef = typeof data.orgRef === 'string' ? data.orgRef : typeof data.tenantId === 'string' ? data.tenantId : null;
    const contactRef = typeof data.contactRef === 'string' && data.contactRef.length <= 80 && !looksPersonal(data.contactRef) ? data.contactRef : null;
    const size = (SIZE_BUCKETS as readonly string[]).includes(data.sizeBucket) ? data.sizeBucket : 'UNKNOWN';
    const dup = await this.prisma.corporateLead.findMany({ where: { status: { notIn: ['LOST', 'DUPLICATE'] } }, select: { id: true, companyName: true }, take: 2000 });
    const same = dup.find((d) => norm(d.companyName) === norm(name));
    try {
      await this.prisma.$transaction(async (tx) => {
        const lead = await tx.corporateLead.create({ data: { market: GROWTH_DEFAULT_MARKET, source: 'B2B_REFERRAL', referrerOrgRef: orgRef, referralRef: ref, companyName: name, sizeBucket: size, contactRef, status: same ? 'DUPLICATE' : 'NEW', notes: same ? `Possible duplicate of lead ${same.id}` : '' } });
        await tx.corporateLeadHistory.create({ data: { leadId: lead.id, toStatus: lead.status, actor: 'system:clinic-referral', note: same ? `duplicate of ${same.id}` : null } });
      });
    } catch (e) { if (!/Unique constraint/.test((e as Error).message)) throw e; }
    return 'APPLIED';
  }

  async create(actor: Actor, i: { companyName: string; source?: 'OUTBOUND' | 'INBOUND'; sizeBucket?: string; contactRef?: string; notes?: string }) {
    const name = i.companyName?.trim();
    if (!name || name.length < 2 || name.length > 120) throw badRequest('INVALID_INPUT', 'companyName must be 2..120 characters');
    this.assertCompanyText(name, i.contactRef, i.notes);
    const lead = await this.prisma.$transaction(async (tx) => {
      const l = await tx.corporateLead.create({ data: { source: i.source ?? 'OUTBOUND', companyName: name, sizeBucket: (SIZE_BUCKETS as readonly string[]).includes(i.sizeBucket ?? '') ? i.sizeBucket! : 'UNKNOWN', contactRef: i.contactRef ?? null, notes: i.notes ?? '', ownerSub: actor.sub } });
      await tx.corporateLeadHistory.create({ data: { leadId: l.id, toStatus: 'NEW', actor: actor.sub } });
      return l;
    });
    return this.view(lead);
  }

  private assertCompanyText(name: string, contactRef?: string | null, notes?: string | null) {
    if (looksPersonal(name) || looksPersonal(contactRef ?? '') || looksPersonal(notes ?? '')) throw unprocessable('CORPORATE_PERSONAL_DATA', 'Leads hold company data only: use an opaque contact reference, never a name, phone or e-mail of a person');
    if ((contactRef ?? '').length > 80 || (notes ?? '').length > 2000) throw badRequest('INVALID_INPUT', 'contactRef is at most 80 and notes at most 2000 characters');
  }

  async list(q: { status?: string; source?: string; take?: number } = {}) {
    const rows = await this.prisma.corporateLead.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.source ? { source: q.source } : {}) }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(q.take ?? 100, 1), 200) });
    const grouped = await this.prisma.corporateLead.groupBy({ by: ['status'], _count: { _all: true } });
    return { items: rows.map((r) => this.view(r)), pipeline: Object.fromEntries(grouped.map((g) => [g.status, g._count._all])) };
  }
  async get(id: string) {
    const l = await this.prisma.corporateLead.findUnique({ where: { id }, include: { history: { orderBy: { at: 'asc' } } } });
    if (!l) throw notFound('CORPORATE_LEAD_NOT_FOUND', 'Lead not found');
    return { ...this.view(l), history: l.history.map((h) => ({ from: h.fromStatus, to: h.toStatus, actor: h.actor, note: h.note, at: h.at.toISOString() })) };
  }

  async transition(actor: Actor, id: string, to: string, note?: string) {
    const l = await this.prisma.corporateLead.findUnique({ where: { id } });
    if (!l) throw notFound('CORPORATE_LEAD_NOT_FOUND', 'Lead not found');
    if (!(LEAD_TRANSITIONS[l.status] ?? []).includes(to)) throw conflict('CORPORATE_LEAD_TRANSITION', `A ${l.status} lead cannot become ${to}`);
    if (note && (looksPersonal(note) || note.length > 500)) throw unprocessable('CORPORATE_PERSONAL_DATA', 'Notes describe the company only (at most 500 characters, no personal contact data)');
    const u = await this.prisma.$transaction(async (tx) => {
      const row = await tx.corporateLead.update({ where: { id }, data: { status: to, ownerSub: l.ownerSub ?? actor.sub } });
      await tx.corporateLeadHistory.create({ data: { leadId: id, fromStatus: l.status, toStatus: to, actor: actor.sub, note: note ?? null } });
      return row;
    });
    return this.view(u);
  }

  async assign(actor: Actor, id: string, ownerSub: string) {
    if (!ownerSub || ownerSub.length > 80) throw badRequest('INVALID_INPUT', 'ownerSub is required');
    try { return this.view(await this.prisma.corporateLead.update({ where: { id }, data: { ownerSub } })); } catch (e) { if ((e as { code?: string }).code === 'P2025') throw notFound('CORPORATE_LEAD_NOT_FOUND', 'Lead not found'); throw e; }
  }

  async setNotes(actor: Actor, id: string, notes: string) {
    this.assertCompanyText('x', null, notes);
    try { return this.view(await this.prisma.corporateLead.update({ where: { id }, data: { notes } })); } catch (e) { if ((e as { code?: string }).code === 'P2025') throw notFound('CORPORATE_LEAD_NOT_FOUND', 'Lead not found'); throw e; }
  }

  private view(l: Prisma.CorporateLeadGetPayload<object>) {
    return { id: l.id, market: l.market, source: l.source, referrerOrgRef: l.referrerOrgRef, companyName: l.companyName, sizeBucket: l.sizeBucket, contactRef: l.contactRef, status: l.status, ownerSub: l.ownerSub, notes: l.notes, accountId: l.accountId, createdAt: l.createdAt.toISOString(), updatedAt: l.updatedAt.toISOString() };
  }
}
