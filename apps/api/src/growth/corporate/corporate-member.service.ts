import { Injectable } from '@nestjs/common';
import { Prisma } from '../../prisma/generated/client';
import { ApiError, badRequest, conflict, forbidden, notFound, unprocessable } from '../../common/errors';
import { PrismaService } from '../../prisma/prisma.service';
import { GrowthLimiter } from '../growth-limiter';
import { GROWTH_DEFAULT_MARKET } from '../growth-flags';
import { hashCode, hrKeyHash, memberHashOf, normaliseCode } from './corporate-code';
import { CorporateConfigService } from './corporate-config';
import { evaluateEligibility, type EligibilityReason } from './corporate-eligibility';
import { CorporateEventsService } from './corporate-events.service';
import { CorporateBenefitService } from './corporate-benefit.service';
import type { Actor } from './corporate.service';

export interface Claims { sub: string; phone?: string; email?: string; emailVerified?: boolean }

const REASON: Record<EligibilityReason, { status: number; code: string; message: string }> = {
  ACCOUNT_NOT_ACTIVE: { status: 422, code: 'CORPORATE_ACCOUNT_NOT_ACTIVE', message: 'This programme is not active' },
  CODE_REVOKED: { status: 422, code: 'CORPORATE_CODE_INVALID', message: 'This code is not valid' },
  CODE_EXPIRED: { status: 422, code: 'CORPORATE_CODE_EXPIRED', message: 'This code has expired' },
  CODE_EXHAUSTED: { status: 422, code: 'CORPORATE_CODE_EXHAUSTED', message: 'This code has reached its limit' },
  ALREADY_MEMBER: { status: 409, code: 'CORPORATE_ALREADY_MEMBER', message: 'You are already in a corporate programme: leave it first' },
  OPEN_CODES_OFF: { status: 422, code: 'CORPORATE_NOT_ELIGIBLE', message: 'Open codes are switched off' },
  HR_LIST_OFF: { status: 422, code: 'CORPORATE_NOT_ELIGIBLE', message: 'List verification is switched off' },
  NOT_ON_HR_LIST: { status: 422, code: 'CORPORATE_NOT_ELIGIBLE', message: 'You are not eligible for this programme' },
  EMAIL_NOT_VERIFIED: { status: 422, code: 'CORPORATE_EMAIL_NOT_VERIFIED', message: 'Verify your work e-mail address in Kiorex Passport first' },
  EMAIL_DOMAIN_MISMATCH: { status: 422, code: 'CORPORATE_NOT_ELIGIBLE', message: 'You are not eligible for this programme' },
  NO_VERIFICATION_PATH: { status: 422, code: 'CORPORATE_NOT_ELIGIBLE', message: 'Enter your company code' },
};

/**
 * Members of a corporate programme (GRW-P4-C): joining by code, by a verified work e-mail domain or by an approved HR list, leaving, and the HR list itself.
 * The employer receives COUNTS only (corporate-report.service). A member row holds a keyed hash, never the Passport sub, a phone or an e-mail. HR list rows are keyed hashes of phone or e-mail,
 * approved by a second person, matched only while the window is open and deleted when it ends (growth_purge_corporate). Redemption is for verified accounts only (the session is the verification).
 * Joining never gives a benefit by itself: the benefit is sized per booking by CorporateBenefitService within the account's ceiling and the member's cap.
 */
@Injectable()
export class CorporateMemberService {
  constructor(private readonly prisma: PrismaService, private readonly config: CorporateConfigService, private readonly events: CorporateEventsService, private readonly limiter: GrowthLimiter, private readonly benefit: CorporateBenefitService) {}

  private fail(r: EligibilityReason): never { const x = REASON[r]; throw new ApiError(x.status, x.code, x.message, { reason: r }); }

  async join(c: Claims, codeInput: string | undefined, now = new Date()) {
    await this.limiter.take('corporate-join', c.sub.slice(0, 24), 10, 3600_000);
    const hash = memberHashOf(c.sub);
    const mine = await this.prisma.corporateMember.findFirst({ where: { subHash: hash, endedAt: null } });
    let account; let code = null;
    if (codeInput !== undefined && codeInput !== '') {
      const norm = normaliseCode(codeInput);
      if (!norm) throw unprocessable('CORPORATE_CODE_INVALID', 'This code is not valid');
      code = await this.prisma.corporateCode.findUnique({ where: { codeHash: hashCode(norm) }, include: { account: true } });
      if (!code) throw unprocessable('CORPORATE_CODE_INVALID', 'This code is not valid');
      account = code.account;
    } else {
      const dom = (c.email ?? '').split('@')[1]?.toLowerCase();
      const found = dom && c.emailVerified ? await this.prisma.corporateAccount.findFirst({ where: { status: 'ACTIVE', emailDomains: { has: dom } }, orderBy: { createdAt: 'asc' } }) : null;
      if (!found) this.fail(c.emailVerified ? 'EMAIL_DOMAIN_MISMATCH' : 'EMAIL_NOT_VERIFIED');
      account = found!;
    }
    const policy = await this.config.get(account.market, now);
    if (!policy.enabled) this.fail('ACCOUNT_NOT_ACTIVE');
    let hrEntryId: string | null = null;
    if (code?.kind === 'LIST') hrEntryId = await this.hrMatch(account.id, c, now);
    const d = evaluateEligibility({ policy: policy.eligibility, account: { status: account.status, startsAt: account.startsAt, endsAt: account.endsAt, emailDomains: account.emailDomains }, code: code ? { status: code.status, kind: code.kind, expiresAt: code.expiresAt, redeemedCount: code.redeemedCount, maxRedemptions: code.maxRedemptions } : null, facts: { email: c.email, emailVerified: c.emailVerified, hrListMatch: !!hrEntryId, alreadyMember: !!mine }, now });
    if (!d.ok) this.fail(d.reason);
    const ok = d as { ok: true; verifiedBy: 'CODE' | 'HR_LIST' | 'DOMAIN_EMAIL' };
    try {
      const m = await this.prisma.$transaction(async (tx) => {
        if (code) {
          const n = await tx.$executeRaw(Prisma.sql`UPDATE "CorporateCode" SET "redeemedCount" = "redeemedCount" + 1 WHERE "id" = ${code.id} AND "status" = 'ACTIVE' AND "redeemedCount" < "maxRedemptions"`);
          if (n !== 1) this.fail('CODE_EXHAUSTED');
        }
        const row = await tx.corporateMember.create({ data: { accountId: account.id, subHash: hash, codeId: code?.id ?? null, verifiedBy: ok.verifiedBy, perMemberCapMinor: code?.perMemberCapMinor ?? null, enrolledAt: now } });
        if (hrEntryId) await tx.corporateHrEntry.update({ where: { id: hrEntryId }, data: { matchedAt: now } });
        await this.events.emit(tx, 'CorporateCodeRedeemed', account.id, { accountRef: account.id, memberRef: row.id, market: account.market, verifiedBy: ok.verifiedBy, at: now.toISOString() }, row.id);
        return row;
      });
      return { member: true, verifiedBy: m.verifiedBy, programme: { sponsor: account.displayName, endsAt: account.endsAt?.toISOString() ?? null } };
    } catch (e) {
      if (/Unique constraint/.test((e as Error).message)) this.fail('ALREADY_MEMBER');
      throw e;
    }
  }

  private async hrMatch(accountId: string, c: Claims, now: Date): Promise<string | null> {
    const hashes = [c.phone && hrKeyHash(c.phone), c.email && c.emailVerified && hrKeyHash(c.email)].filter(Boolean) as string[];
    if (!hashes.length) return null;
    const e = await this.prisma.corporateHrEntry.findFirst({ where: { keyHash: { in: hashes }, matchedAt: null, batch: { accountId, status: 'APPROVED', windowEndsAt: { gt: now } } } });
    return e?.id ?? null;
  }

  /** Leave the programme: eligibility ends at once, history stays, a held benefit settles normally. */
  async leave(sub: string, now = new Date()) {
    const r = await this.prisma.corporateMember.updateMany({ where: { subHash: memberHashOf(sub), endedAt: null }, data: { endedAt: now, endReason: 'LEFT' } });
    return { left: r.count > 0 };
  }

  /** My own state. The allowance figures are MY usage against MY cap (no cash value, no balance to move). */
  async me(sub: string, now = new Date()) {
    const m = await this.benefit.activeMembership(sub, now);
    if (!m) return { member: false as const };
    const use = await this.benefit.use(this.prisma, { memberId: m.id });
    const cap = m.perMemberCapMinor ?? m.account.perMemberCapMinor ?? 0;
    return { member: true as const, programme: { sponsor: m.account.displayName, endsAt: m.account.endsAt?.toISOString() ?? null, currency: m.account.currency }, allowance: { capMinor: cap, usedMinor: Math.max(0, use.net), heldMinor: Math.max(0, use.held), remainingMinor: Math.max(0, cap - use.used) }, verifiedBy: m.verifiedBy, enrolledAt: m.enrolledAt.toISOString() };
  }

  /** Members of accounts that ended or whose end date passed lose eligibility (the account row decides; this keeps the member rows honest). */
  async endExpired(now = new Date()): Promise<number> {
    const ids = await this.prisma.$queryRaw<{ id: string }[]>(Prisma.sql`SELECT m."id" FROM "CorporateMember" m JOIN "CorporateAccount" a ON a."id" = m."accountId" WHERE m."endedAt" IS NULL AND (a."status" = 'ENDED' OR a."endsAt" <= ${now}) LIMIT 5000`);
    if (!ids.length) return 0;
    return (await this.prisma.corporateMember.updateMany({ where: { id: { in: ids.map((r) => r.id) }, endedAt: null }, data: { endedAt: now, endReason: 'ACCOUNT_ENDED' } })).count;
  }

  // ── HR lists (two-person) ──
  async uploadHrList(actor: Actor, accountId: string, rows: string[], now = new Date()) {
    const a = await this.prisma.corporateAccount.findUnique({ where: { id: accountId } });
    if (!a) throw notFound('CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found');
    if (a.status === 'ENDED') throw conflict('CORPORATE_ACCOUNT_NOT_ACTIVE', 'The account has ended');
    const policy = await this.config.get(a.market, now);
    if (!policy.eligibility.hrList) throw forbidden('CORPORATE_NOT_ELIGIBLE', 'HR list verification is switched off in CORPORATE_POLICY');
    if (!Array.isArray(rows) || !rows.length) throw badRequest('INVALID_INPUT', 'rows must be a non-empty list');
    if (rows.length > policy.hrList.maxRows) throw unprocessable('CORPORATE_HR_TOO_LARGE', `At most ${policy.hrList.maxRows} rows per list`);
    const hashes = new Set<string>(); let invalid = 0;
    for (const r of rows) {
      const v = typeof r === 'string' ? r.trim() : '';
      const isMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v); const digits = v.replace(/[\s()-]/g, '');
      if (isMail || /^\+?\d{8,15}$/.test(digits)) hashes.add(hrKeyHash(isMail ? v : digits)); else invalid++;
    }
    if (!hashes.size) throw unprocessable('CORPORATE_HR_EMPTY', 'No valid phone number or e-mail address in the list');
    const b = await this.prisma.$transaction(async (tx) => {
      const batch = await tx.corporateHrBatch.create({ data: { accountId, rowCount: hashes.size, uploadedBy: actor.sub } });
      const arr = [...hashes];
      for (let i = 0; i < arr.length; i += 1000) await tx.corporateHrEntry.createMany({ data: arr.slice(i, i + 1000).map((keyHash) => ({ batchId: batch.id, keyHash })) });
      return batch;
    });
    await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.corporate.hr_list_uploaded', resource: 'CorporateAccount', resourceId: accountId, metadata: { batchId: b.id, rows: hashes.size, invalid } } });
    return { batchId: b.id, status: b.status, rowCount: b.rowCount, invalidRows: invalid };
  }

  async decideHrList(actor: Actor, batchId: string, decision: 'APPROVED' | 'REJECTED', now = new Date()) {
    const b = await this.prisma.corporateHrBatch.findUnique({ where: { id: batchId }, include: { account: true } });
    if (!b) throw notFound('CORPORATE_HR_BATCH_NOT_FOUND', 'HR list not found');
    if (b.status !== 'PENDING_APPROVAL') throw conflict('CORPORATE_HR_STATE', `The list is ${b.status}`);
    if (b.uploadedBy === actor.sub) throw forbidden('CORPORATE_SELF_APPROVAL', 'A second person must approve: you uploaded this list');
    const policy = await this.config.get(b.account.market, now);
    const u = await this.prisma.corporateHrBatch.update({ where: { id: batchId }, data: decision === 'APPROVED' ? { status: 'APPROVED', approvedBy: actor.sub, approvedAt: now, windowEndsAt: new Date(now.getTime() + policy.hrList.matchWindowDays * 86400_000) } : { status: 'REJECTED', approvedBy: actor.sub, approvedAt: now } });
    await this.prisma.auditLog.create({ data: { actor: actor.sub, action: `growth.corporate.hr_list_${decision.toLowerCase()}`, resource: 'CorporateAccount', resourceId: b.accountId, metadata: { batchId } } });
    return { batchId, status: u.status, windowEndsAt: u.windowEndsAt?.toISOString() ?? null };
  }

  /** Counts only: how many rows, how many matched. No row is ever returned. */
  async hrBatches(accountId: string) {
    const rows = await this.prisma.corporateHrBatch.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50, include: { _count: { select: { entries: true } } } });
    return { items: rows.map((b) => ({ id: b.id, status: b.status, rowCount: b.rowCount, rowsHeld: b._count.entries, windowEndsAt: b.windowEndsAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString() })) };
  }
}
