"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.CorporateMemberService = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../../prisma/generated/client");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_limiter_1 = require("../growth-limiter");
const corporate_code_1 = require("./corporate-code");
const corporate_config_1 = require("./corporate-config");
const corporate_eligibility_1 = require("./corporate-eligibility");
const corporate_events_service_1 = require("./corporate-events.service");
const corporate_benefit_service_1 = require("./corporate-benefit.service");
const REASON = {
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
let CorporateMemberService = class CorporateMemberService {
    prisma;
    config;
    events;
    limiter;
    benefit;
    constructor(prisma, config, events, limiter, benefit) {
        this.prisma = prisma;
        this.config = config;
        this.events = events;
        this.limiter = limiter;
        this.benefit = benefit;
    }
    fail(r) { const x = REASON[r]; throw new errors_1.ApiError(x.status, x.code, x.message, { reason: r }); }
    async join(c, codeInput, now = new Date()) {
        await this.limiter.take('corporate-join', c.sub.slice(0, 24), 10, 3600_000);
        const hash = (0, corporate_code_1.memberHashOf)(c.sub);
        const mine = await this.prisma.corporateMember.findFirst({ where: { subHash: hash, endedAt: null } });
        let account;
        let code = null;
        if (codeInput !== undefined && codeInput !== '') {
            const norm = (0, corporate_code_1.normaliseCode)(codeInput);
            if (!norm)
                throw (0, errors_1.unprocessable)('CORPORATE_CODE_INVALID', 'This code is not valid');
            code = await this.prisma.corporateCode.findUnique({ where: { codeHash: (0, corporate_code_1.hashCode)(norm) }, include: { account: true } });
            if (!code)
                throw (0, errors_1.unprocessable)('CORPORATE_CODE_INVALID', 'This code is not valid');
            account = code.account;
        }
        else {
            const dom = (c.email ?? '').split('@')[1]?.toLowerCase();
            const found = dom && c.emailVerified ? await this.prisma.corporateAccount.findFirst({ where: { status: 'ACTIVE', emailDomains: { has: dom } }, orderBy: { createdAt: 'asc' } }) : null;
            if (!found)
                this.fail(c.emailVerified ? 'EMAIL_DOMAIN_MISMATCH' : 'EMAIL_NOT_VERIFIED');
            account = found;
        }
        const policy = await this.config.get(account.market, now);
        if (!policy.enabled)
            this.fail('ACCOUNT_NOT_ACTIVE');
        let hrEntryId = null;
        if (code?.kind === 'LIST')
            hrEntryId = await this.hrMatch(account.id, c, now);
        const d = (0, corporate_eligibility_1.evaluateEligibility)({ policy: policy.eligibility, account: { status: account.status, startsAt: account.startsAt, endsAt: account.endsAt, emailDomains: account.emailDomains }, code: code ? { status: code.status, kind: code.kind, expiresAt: code.expiresAt, redeemedCount: code.redeemedCount, maxRedemptions: code.maxRedemptions } : null, facts: { email: c.email, emailVerified: c.emailVerified, hrListMatch: !!hrEntryId, alreadyMember: !!mine }, now });
        if (!d.ok)
            this.fail(d.reason);
        const ok = d;
        try {
            const m = await this.prisma.$transaction(async (tx) => {
                if (code) {
                    const n = await tx.$executeRaw(client_1.Prisma.sql `UPDATE "CorporateCode" SET "redeemedCount" = "redeemedCount" + 1 WHERE "id" = ${code.id} AND "status" = 'ACTIVE' AND "redeemedCount" < "maxRedemptions"`);
                    if (n !== 1)
                        this.fail('CODE_EXHAUSTED');
                }
                const row = await tx.corporateMember.create({ data: { accountId: account.id, subHash: hash, codeId: code?.id ?? null, verifiedBy: ok.verifiedBy, perMemberCapMinor: code?.perMemberCapMinor ?? null, enrolledAt: now } });
                if (hrEntryId)
                    await tx.corporateHrEntry.update({ where: { id: hrEntryId }, data: { matchedAt: now } });
                await this.events.emit(tx, 'CorporateCodeRedeemed', account.id, { accountRef: account.id, memberRef: row.id, market: account.market, verifiedBy: ok.verifiedBy, at: now.toISOString() }, row.id);
                return row;
            });
            return { member: true, verifiedBy: m.verifiedBy, programme: { sponsor: account.displayName, endsAt: account.endsAt?.toISOString() ?? null } };
        }
        catch (e) {
            if (/Unique constraint/.test(e.message))
                this.fail('ALREADY_MEMBER');
            throw e;
        }
    }
    async hrMatch(accountId, c, now) {
        const hashes = [c.phone && (0, corporate_code_1.hrKeyHash)(c.phone), c.email && c.emailVerified && (0, corporate_code_1.hrKeyHash)(c.email)].filter(Boolean);
        if (!hashes.length)
            return null;
        const e = await this.prisma.corporateHrEntry.findFirst({ where: { keyHash: { in: hashes }, matchedAt: null, batch: { accountId, status: 'APPROVED', windowEndsAt: { gt: now } } } });
        return e?.id ?? null;
    }
    async leave(sub, now = new Date()) {
        const r = await this.prisma.corporateMember.updateMany({ where: { subHash: (0, corporate_code_1.memberHashOf)(sub), endedAt: null }, data: { endedAt: now, endReason: 'LEFT' } });
        return { left: r.count > 0 };
    }
    async me(sub, now = new Date()) {
        const m = await this.benefit.activeMembership(sub, now);
        if (!m)
            return { member: false };
        const use = await this.benefit.use(this.prisma, { memberId: m.id });
        const cap = m.perMemberCapMinor ?? m.account.perMemberCapMinor ?? 0;
        return { member: true, programme: { sponsor: m.account.displayName, endsAt: m.account.endsAt?.toISOString() ?? null, currency: m.account.currency }, allowance: { capMinor: cap, usedMinor: Math.max(0, use.net), heldMinor: Math.max(0, use.held), remainingMinor: Math.max(0, cap - use.used) }, verifiedBy: m.verifiedBy, enrolledAt: m.enrolledAt.toISOString() };
    }
    async endExpired(now = new Date()) {
        const ids = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT m."id" FROM "CorporateMember" m JOIN "CorporateAccount" a ON a."id" = m."accountId" WHERE m."endedAt" IS NULL AND (a."status" = 'ENDED' OR a."endsAt" <= ${now}) LIMIT 5000`);
        if (!ids.length)
            return 0;
        return (await this.prisma.corporateMember.updateMany({ where: { id: { in: ids.map((r) => r.id) }, endedAt: null }, data: { endedAt: now, endReason: 'ACCOUNT_ENDED' } })).count;
    }
    async uploadHrList(actor, accountId, rows, now = new Date()) {
        const a = await this.prisma.corporateAccount.findUnique({ where: { id: accountId } });
        if (!a)
            throw (0, errors_1.notFound)('CORPORATE_ACCOUNT_NOT_FOUND', 'Corporate account not found');
        if (a.status === 'ENDED')
            throw (0, errors_1.conflict)('CORPORATE_ACCOUNT_NOT_ACTIVE', 'The account has ended');
        const policy = await this.config.get(a.market, now);
        if (!policy.eligibility.hrList)
            throw (0, errors_1.forbidden)('CORPORATE_NOT_ELIGIBLE', 'HR list verification is switched off in CORPORATE_POLICY');
        if (!Array.isArray(rows) || !rows.length)
            throw (0, errors_1.badRequest)('INVALID_INPUT', 'rows must be a non-empty list');
        if (rows.length > policy.hrList.maxRows)
            throw (0, errors_1.unprocessable)('CORPORATE_HR_TOO_LARGE', `At most ${policy.hrList.maxRows} rows per list`);
        const hashes = new Set();
        let invalid = 0;
        for (const r of rows) {
            const v = typeof r === 'string' ? r.trim() : '';
            const isMail = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v);
            const digits = v.replace(/[\s()-]/g, '');
            if (isMail || /^\+?\d{8,15}$/.test(digits))
                hashes.add((0, corporate_code_1.hrKeyHash)(isMail ? v : digits));
            else
                invalid++;
        }
        if (!hashes.size)
            throw (0, errors_1.unprocessable)('CORPORATE_HR_EMPTY', 'No valid phone number or e-mail address in the list');
        const b = await this.prisma.$transaction(async (tx) => {
            const batch = await tx.corporateHrBatch.create({ data: { accountId, rowCount: hashes.size, uploadedBy: actor.sub } });
            const arr = [...hashes];
            for (let i = 0; i < arr.length; i += 1000)
                await tx.corporateHrEntry.createMany({ data: arr.slice(i, i + 1000).map((keyHash) => ({ batchId: batch.id, keyHash })) });
            return batch;
        });
        await this.prisma.auditLog.create({ data: { actor: actor.sub, action: 'growth.corporate.hr_list_uploaded', resource: 'CorporateAccount', resourceId: accountId, metadata: { batchId: b.id, rows: hashes.size, invalid } } });
        return { batchId: b.id, status: b.status, rowCount: b.rowCount, invalidRows: invalid };
    }
    async decideHrList(actor, batchId, decision, now = new Date()) {
        const b = await this.prisma.corporateHrBatch.findUnique({ where: { id: batchId }, include: { account: true } });
        if (!b)
            throw (0, errors_1.notFound)('CORPORATE_HR_BATCH_NOT_FOUND', 'HR list not found');
        if (b.status !== 'PENDING_APPROVAL')
            throw (0, errors_1.conflict)('CORPORATE_HR_STATE', `The list is ${b.status}`);
        if (b.uploadedBy === actor.sub)
            throw (0, errors_1.forbidden)('CORPORATE_SELF_APPROVAL', 'A second person must approve: you uploaded this list');
        const policy = await this.config.get(b.account.market, now);
        const u = await this.prisma.corporateHrBatch.update({ where: { id: batchId }, data: decision === 'APPROVED' ? { status: 'APPROVED', approvedBy: actor.sub, approvedAt: now, windowEndsAt: new Date(now.getTime() + policy.hrList.matchWindowDays * 86400_000) } : { status: 'REJECTED', approvedBy: actor.sub, approvedAt: now } });
        await this.prisma.auditLog.create({ data: { actor: actor.sub, action: `growth.corporate.hr_list_${decision.toLowerCase()}`, resource: 'CorporateAccount', resourceId: b.accountId, metadata: { batchId } } });
        return { batchId, status: u.status, windowEndsAt: u.windowEndsAt?.toISOString() ?? null };
    }
    async hrBatches(accountId) {
        const rows = await this.prisma.corporateHrBatch.findMany({ where: { accountId }, orderBy: { createdAt: 'desc' }, take: 50, include: { _count: { select: { entries: true } } } });
        return { items: rows.map((b) => ({ id: b.id, status: b.status, rowCount: b.rowCount, rowsHeld: b._count.entries, windowEndsAt: b.windowEndsAt?.toISOString() ?? null, createdAt: b.createdAt.toISOString() })) };
    }
};
exports.CorporateMemberService = CorporateMemberService;
exports.CorporateMemberService = CorporateMemberService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, corporate_config_1.CorporateConfigService, corporate_events_service_1.CorporateEventsService, growth_limiter_1.GrowthLimiter, corporate_benefit_service_1.CorporateBenefitService])
], CorporateMemberService);
//# sourceMappingURL=corporate-member.service.js.map