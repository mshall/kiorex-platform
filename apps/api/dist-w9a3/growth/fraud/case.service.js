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
exports.FraudCaseService = exports.parseDecision = exports.encodeDecision = exports.bandFromDb = exports.dbBand = void 0;
exports.rescore = rescore;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
const fraud_hold_service_1 = require("./fraud-hold.service");
const scoring_1 = require("./scoring");
const DAY = 86_400_000;
const dbBand = (b) => (b === 'HOLD' ? 'HIGH' : b === 'REVIEW' ? 'MEDIUM' : 'LOW');
exports.dbBand = dbBand;
const bandFromDb = (b) => (b === 'HIGH' ? 'HOLD' : b === 'MEDIUM' ? 'REVIEW' : 'ALLOW');
exports.bandFromDb = bandFromDb;
const encodeDecision = (d) => (d.decision === 'DISMISS' ? 'DISMISS' : `CONFIRM${d.reverse ? ';reverse=1' : ''}${d.suspendDays ? `;suspend=${d.suspendDays}` : ''}`);
exports.encodeDecision = encodeDecision;
const parseDecision = (s) => {
    if (!s)
        return { decision: null, reverse: false, suspendDays: 0 };
    const parts = s.split(';');
    return { decision: parts[0] === 'CONFIRM' ? 'CONFIRM' : parts[0] === 'DISMISS' ? 'DISMISS' : null, reverse: parts.includes('reverse=1'), suspendDays: Number(parts.find((p) => p.startsWith('suspend='))?.slice(8)) || 0 };
};
exports.parseDecision = parseDecision;
function rescore(weights, cfg) {
    const best = new Map();
    for (const w of weights)
        best.set(w.ruleId, Math.max(best.get(w.ruleId) ?? 0, w.weight));
    const sorted = [...best.values()].sort((a, b) => b - a);
    let t = 0;
    sorted.forEach((w, i) => { t += w * Math.pow(cfg.diminishing, i); });
    const score = Math.min(100, Math.max(0, Math.round(t)));
    return { score, band: (0, scoring_1.bandOf)(score, cfg.bands) };
}
let FraudCaseService = class FraudCaseService {
    prisma;
    hold;
    constructor(prisma, hold) {
        this.prisma = prisma;
        this.hold = hold;
    }
    async record(ev, i) {
        if (!ev.signals.length || ev.shadow.band === 'ALLOW')
            return null;
        const subjectHash = (0, privacy_hash_1.subRefOf)(i.subject);
        const enforced = ev.enforced.contributions.length > 0;
        const find = () => this.prisma.fraudCase.findFirst({ where: { market: i.market, subjectHash, kind: ev.kind, status: { in: ['OPEN', 'IN_REVIEW', 'APPEALED'] } } });
        let existing = await find();
        let created = false;
        if (!existing) {
            try {
                existing = await this.prisma.fraudCase.create({ data: { market: i.market, subjectHash, kind: ev.kind, score: ev.shadow.score, band: (0, exports.dbBand)(ev.shadow.band), mode: enforced ? 'ENFORCE' : 'SHADOW', slaDueAt: new Date(Date.now() + i.cfg.reviewSlaHours * 3_600_000) } });
                created = true;
                await this.prisma.fraudDecisionLog.create({ data: { caseId: existing.id, action: 'OPENED', toStatus: 'OPEN', actor: 'system:fraud', note: `${ev.shadow.band} ${ev.shadow.score}${ev.wouldHaveBeenHeld ? ` shadow-would:${ev.shadowAction}` : ''}` } });
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
                existing = await find();
                if (!existing)
                    throw e;
            }
        }
        const contribution = new Map(ev.shadow.contributions.map((c) => [c.ruleId, Math.round(c.contribution)]));
        await this.prisma.fraudCaseSignal.createMany({
            data: ev.signals.map((s) => ({ caseId: existing.id, ruleId: s.ruleId, weight: Math.min(100, Math.max(-100, contribution.get(s.ruleId) ?? 0)), evidenceRef: i.evidenceRef })), skipDuplicates: true,
        });
        const all = await this.prisma.fraudCaseSignal.findMany({ where: { caseId: existing.id }, select: { ruleId: true, weight: true } });
        const rs = rescore(all, i.cfg);
        const newBand = (0, exports.dbBand)(rs.band);
        if (rs.score !== existing.score || newBand !== existing.band || (enforced && existing.mode !== 'ENFORCE')) {
            await this.prisma.fraudCase.update({ where: { id: existing.id }, data: { score: rs.score, band: newBand, ...(enforced ? { mode: 'ENFORCE' } : {}), updatedAt: new Date() } });
            if (newBand !== existing.band && !created)
                await this.prisma.fraudDecisionLog.create({ data: { caseId: existing.id, action: 'SCORED', fromStatus: existing.status, toStatus: existing.status, actor: 'system:fraud', note: `${existing.band}->${newBand} ${rs.score}` } });
        }
        return { id: existing.id, created, band: rs.band };
    }
    async evidence(id) {
        const c = await this.prisma.fraudCase.findUnique({ where: { id } });
        if (!c)
            throw new errors_1.ApiError(404, 'FRAUD_CASE_NOT_FOUND', 'Case not found');
        const signals = await this.prisma.fraudCaseSignal.findMany({ where: { caseId: id }, orderBy: { at: 'asc' } });
        const log = await this.prisma.fraudDecisionLog.findMany({ where: { caseId: id }, orderBy: { at: 'asc' } });
        const relIds = (0, fraud_hold_service_1.relationshipIdsOf)(signals.map((s) => s.evidenceRef));
        const checks = relIds.length ? await this.prisma.referralQualificationCheck.findMany({ where: { relationshipId: { in: relIds } }, orderBy: { at: 'asc' }, select: { relationshipId: true, checkKey: true, passed: true, detail: true, at: true } }) : [];
        return {
            case: { id: c.id, kind: c.kind, score: c.score, band: c.band, status: c.status, mode: c.mode, slaDueAt: c.slaDueAt, assignedTo: c.assignedTo, decision: (0, exports.parseDecision)(c.decision), decisionNote: c.decisionNote, decidedBy: c.decidedBy, createdAt: c.createdAt, decidedAt: c.decidedAt, subjectRef: c.subjectHash.slice(0, 12) },
            signals: signals.map((s) => ({ ruleId: s.ruleId, weight: s.weight, evidenceRef: s.evidenceRef, at: s.at })),
            checks: checks.map((k) => ({ relationshipRef: k.relationshipId, key: k.checkKey, passed: k.passed, detail: k.detail, at: k.at })),
            log: log.map((l) => ({ action: l.action, from: l.fromStatus, to: l.toStatus, actor: l.actor, note: l.note, at: l.at })),
        };
    }
    async identity(id, actor, reason) {
        if (!reason || reason.trim().length < 10)
            throw new errors_1.ApiError(400, 'REASON_REQUIRED', 'Say why the identity is needed (at least 10 characters)');
        const signals = await this.prisma.fraudCaseSignal.findMany({ where: { caseId: id }, select: { evidenceRef: true } });
        const rels = (0, fraud_hold_service_1.relationshipIdsOf)(signals.map((s) => s.evidenceRef));
        const rows = rels.length ? await this.prisma.referralRelationship.findMany({ where: { id: { in: rels } }, select: { id: true, referrerSub: true, refereeSub: true } }) : [];
        await this.prisma.auditLog.create({ data: { actor, action: 'growth.fraud.identity_lookup', resource: 'FraudCase', resourceId: id, metadata: { reason: reason.slice(0, 200), relationships: rows.length } } });
        return { accounts: rows.map((r) => ({ relationshipRef: r.id, referrerSub: r.referrerSub, refereeSub: r.refereeSub })), audited: true };
    }
    async load(id) {
        const c = await this.prisma.fraudCase.findUnique({ where: { id } });
        if (!c)
            throw new errors_1.ApiError(404, 'FRAUD_CASE_NOT_FOUND', 'Case not found');
        return c;
    }
    async relsOf(caseId) {
        return (0, fraud_hold_service_1.relationshipIdsOf)((await this.prisma.fraudCaseSignal.findMany({ where: { caseId }, select: { evidenceRef: true } })).map((s) => s.evidenceRef));
    }
    async setStatus(id, from, to, action, actor, note, data = {}) {
        await this.prisma.$transaction(async (tx) => {
            const r = await tx.fraudCase.updateMany({ where: { id, status: from }, data: { status: to, updatedAt: new Date(), ...data } });
            if (r.count !== 1)
                throw new errors_1.ApiError(409, 'FRAUD_CASE_STATE_CHANGED', 'The case changed while you were deciding; reload it');
            await tx.fraudDecisionLog.create({ data: { caseId: id, action, fromStatus: from, toStatus: to, actor, note: note?.slice(0, 300) } });
        });
    }
    async assign(id, actor, assignTo) {
        const c = await this.load(id);
        if (!['OPEN', 'IN_REVIEW'].includes(c.status))
            throw new errors_1.ApiError(409, 'FRAUD_CASE_NOT_OPEN', `The case is ${c.status}`);
        if (c.status === 'OPEN')
            await this.setStatus(id, 'OPEN', 'IN_REVIEW', 'ASSIGNED', actor, `assigned to ${assignTo}`, { assignedTo: assignTo });
        else {
            await this.prisma.fraudCase.update({ where: { id }, data: { assignedTo: assignTo } });
            await this.prisma.fraudDecisionLog.create({ data: { caseId: id, action: 'ASSIGNED', fromStatus: 'IN_REVIEW', toStatus: 'IN_REVIEW', actor, note: `assigned to ${assignTo}` } });
        }
        return { status: 'IN_REVIEW', assignedTo: assignTo };
    }
    async decide(id, actor, d, cfg, now = new Date()) {
        const c = await this.load(id);
        if (!['OPEN', 'IN_REVIEW'].includes(c.status))
            throw new errors_1.ApiError(409, 'FRAUD_CASE_NOT_OPEN', `The case is ${c.status}`);
        if (d.decision === 'DISMISS') {
            if (!d.note || d.note.trim().length < 10)
                throw new errors_1.ApiError(400, 'REASON_REQUIRED', 'A dismissal needs a reason (at least 10 characters)');
            await this.setStatus(id, c.status, 'DISMISSED', 'DISMISSED', actor, d.note, { decision: 'DISMISS', decisionNote: d.note.slice(0, 300), decidedBy: actor, decidedAt: now });
            const rels = await this.relsOf(id);
            await this.hold.releaseRewards(rels);
            await this.hold.reinstateReferral(rels);
            return { status: 'DISMISSED' };
        }
        const suspendDays = d.suspendDays ? Math.min(cfg.banMaxDays, Math.max(1, Math.floor(d.suspendDays))) : 0;
        if (d.suspendDays && d.suspendDays > cfg.banMaxDays)
            throw new errors_1.ApiError(400, 'SUSPENSION_TOO_LONG', `A suspension is at most ${cfg.banMaxDays} days`);
        let params = { reverse: !!d.reverseRewards, suspendDays, note: d.note };
        let confirmedBy = actor;
        let requestedBy;
        const open = cfg.twoPersonOnMoney ? await this.prisma.auditLog.findFirst({ where: { action: 'growth.fraud.confirm_requested', resourceId: id, createdAt: { gte: new Date(now.getTime() - DAY) } }, orderBy: { createdAt: 'desc' } }) : null;
        if (open) {
            if (open.actor === actor)
                throw new errors_1.ApiError(409, 'CONFIRM_NEEDS_SECOND_PERSON', 'A different reviewer must confirm a decision that reverses reward value');
            const m = (open.metadata ?? {});
            params = { reverse: true, suspendDays: Number(m.suspendDays) || 0, note: m.note ?? d.note };
            requestedBy = open.actor;
        }
        else if (params.reverse && cfg.twoPersonOnMoney) {
            await this.prisma.auditLog.create({ data: { actor, action: 'growth.fraud.confirm_requested', resource: 'FraudCase', resourceId: id, metadata: { reverse: true, suspendDays, note: d.note?.slice(0, 300) } } });
            return { status: 'CONFIRM_REQUESTED' };
        }
        const rels = await this.relsOf(id);
        let reversed = { reversedMinor: 0, lots: 0 };
        if (params.reverse)
            reversed = await this.hold.reverseRewards(rels, confirmedBy);
        else
            await this.hold.releaseRewards(rels, 'FRAUD_CONFIRMED_NO_REVERSAL');
        if (params.suspendDays)
            await this.hold.suspendReferral(rels);
        await this.setStatus(id, c.status, 'CONFIRMED', 'CONFIRMED', confirmedBy, `${params.note ?? ''}${requestedBy ? ` (requested by ${requestedBy})` : ''}`.trim(), { decision: (0, exports.encodeDecision)({ decision: 'CONFIRM', reverse: params.reverse, suspendDays: params.suspendDays }), decisionNote: params.note?.slice(0, 300), decidedBy: confirmedBy, decidedAt: now });
        if (params.reverse)
            await this.prisma.auditLog.create({ data: { actor: confirmedBy, action: 'growth.fraud.confirm_executed', resource: 'FraudCase', resourceId: id, metadata: { requestedBy, reversedMinor: reversed.reversedMinor, lots: reversed.lots } } });
        return { status: 'CONFIRMED', reversedMinor: reversed.reversedMinor, suspendedDays: params.suspendDays };
    }
    async appeal(id, actor, note, cfg, now = new Date()) {
        const c = await this.load(id);
        if (c.status !== 'CONFIRMED')
            throw new errors_1.ApiError(409, 'FRAUD_CASE_NOT_APPEALABLE', 'Only a confirmed case can be appealed');
        if (c.decidedAt && now.getTime() - c.decidedAt.getTime() > cfg.appealWindowDays * DAY)
            throw new errors_1.ApiError(409, 'APPEAL_WINDOW_CLOSED', `Appeals are accepted for ${cfg.appealWindowDays} days after the decision`);
        if (!note || note.trim().length < 10)
            throw new errors_1.ApiError(400, 'REASON_REQUIRED', 'Record what the patient said (at least 10 characters)');
        await this.setStatus(id, 'CONFIRMED', 'APPEALED', 'APPEALED', actor, note, { assignedTo: null, slaDueAt: new Date(now.getTime() + cfg.reviewSlaHours * 3_600_000) });
        return { status: 'APPEALED' };
    }
    async redecide(id, actor, d, now = new Date()) {
        const c = await this.load(id);
        if (c.status !== 'APPEALED')
            throw new errors_1.ApiError(409, 'FRAUD_CASE_NOT_APPEALED', 'The case is not under appeal');
        if (c.decidedBy === actor)
            throw new errors_1.ApiError(409, 'APPEAL_NEEDS_DIFFERENT_REVIEWER', 'An appeal is decided by a different person');
        if (!d.note || d.note.trim().length < 10)
            throw new errors_1.ApiError(400, 'REASON_REQUIRED', 'A decision needs a reason (at least 10 characters)');
        if (d.decision === 'DISMISS') {
            await this.setStatus(id, 'APPEALED', 'DISMISSED', 'DISMISSED', actor, `APPEAL_UPHELD ${d.note}`, { decision: 'DISMISS', decisionNote: d.note.slice(0, 300), decidedBy: actor, decidedAt: now });
            const rels = await this.relsOf(id);
            await this.hold.reinstateReferral(rels);
            await this.hold.releaseRewards(rels);
            const restore = await this.restoreAfterUpheldAppeal(id, actor, rels, now);
            return { status: 'DISMISSED', appeal: 'UPHELD', restoreRequests: restore.requests };
        }
        await this.setStatus(id, 'APPEALED', 'CONFIRMED', 'CONFIRMED', actor, `APPEAL_REJECTED ${d.note}`, { decisionNote: d.note.slice(0, 300), decidedBy: actor, decidedAt: now });
        return { status: 'CONFIRMED', appeal: 'REJECTED' };
    }
    async restoreAfterUpheldAppeal(caseId, requestedBy, relationshipIds, now = new Date()) {
        if (!relationshipIds.length)
            return { requests: 0, amountMinor: 0 };
        const lots = await this.prisma.rewardLot.findMany({ where: { relationshipId: { in: relationshipIds } }, select: { id: true, sub: true } });
        if (!lots.length)
            return { requests: 0, amountMinor: 0 };
        const rev = await this.prisma.rewardLedgerEntry.findMany({ where: { lotId: { in: lots.map((l) => l.id) }, type: 'REVERSE', reasonCode: 'FRAUD_CONFIRMED' }, select: { lotId: true, amountMinor: true } });
        const subOf = new Map(lots.map((l) => [l.id, l.sub]));
        const bySub = new Map();
        for (const r of rev) {
            const s = subOf.get(r.lotId);
            if (s)
                bySub.set(s, (bySub.get(s) ?? 0) + r.amountMinor);
        }
        let requests = 0;
        let total = 0;
        const ticketRef = `fraud-appeal:${caseId}`;
        for (const [sub, amountMinor] of bySub) {
            if (amountMinor <= 0)
                continue;
            if (await this.prisma.rewardApprovalRequest.findFirst({ where: { kind: 'GOODWILL', sub, ticketRef }, select: { id: true } }))
                continue;
            const r = await this.prisma.rewardApprovalRequest.create({ data: { kind: 'GOODWILL', sub, amountMinor, reason: 'OTHER_APPROVED', ticketRef, payload: { source: 'FRAUD_APPEAL_UPHELD', caseId, createdAt: now.toISOString() }, requestedBy } });
            await this.prisma.auditLog.create({ data: { actor: requestedBy, action: 'growth.fraud.restore_requested', resource: 'RewardApprovalRequest', resourceId: r.id, metadata: { caseId, amountMinor } } });
            requests++;
            total += amountMinor;
        }
        return { requests, amountMinor: total };
    }
    async housekeeping(cfg, now = new Date()) {
        const due = await this.prisma.fraudCase.findMany({ where: { status: { in: ['CONFIRMED', 'DISMISSED'] }, decidedAt: { lt: new Date(now.getTime() - cfg.appealWindowDays * DAY) } }, select: { id: true, status: true } });
        for (const c of due)
            await this.setStatus(c.id, c.status, 'CLOSED', 'CLOSED', 'system:fraud', 'appeal window over').catch(() => undefined);
        let reinstated = 0;
        const confirmed = await this.prisma.fraudCase.findMany({ where: { status: { in: ['CONFIRMED', 'CLOSED'] }, decision: { contains: 'suspend=' } }, select: { id: true, decision: true, decidedAt: true } });
        for (const c of confirmed) {
            const p = (0, exports.parseDecision)(c.decision);
            if (!p.suspendDays || !c.decidedAt || c.decidedAt.getTime() + p.suspendDays * DAY > now.getTime())
                continue;
            if (await this.prisma.auditLog.findFirst({ where: { action: 'growth.fraud.suspension_ended', resourceId: c.id }, select: { id: true } }))
                continue;
            reinstated += await this.hold.reinstateReferral(await this.relsOf(c.id));
            await this.prisma.auditLog.create({ data: { actor: 'system:fraud', action: 'growth.fraud.suspension_ended', resource: 'FraudCase', resourceId: c.id, metadata: { days: p.suspendDays } } });
        }
        return { closed: due.length, reinstated };
    }
};
exports.FraudCaseService = FraudCaseService;
exports.FraudCaseService = FraudCaseService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, fraud_hold_service_1.FraudHoldService])
], FraudCaseService);
//# sourceMappingURL=case.service.js.map