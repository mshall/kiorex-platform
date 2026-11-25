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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AttributionService = exports.ATTRIBUTION_INTERNAL_EVENTS = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const outbox_public_1 = require("../../outbox/outbox-public");
const patient_public_1 = require("../../patient/patient-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const link_token_1 = require("../consent/link-token");
const link_registry_service_1 = require("../links/link-registry.service");
const touch_rules_1 = require("../fraud/touch-rules");
const growth_errors_1 = require("../growth-errors");
const growth_failures_1 = require("../growth-failures");
const growth_flags_1 = require("../growth-flags");
const growth_secrets_1 = require("../growth-secrets");
const decide_1 = require("./decide");
const policy_1 = require("./policy");
exports.ATTRIBUTION_INTERNAL_EVENTS = ['AttributionAssigned', 'PatientAcquisitionRecorded'];
const iso = (d) => d.toISOString();
const asTouch = (t) => ({ id: t.id, kind: t.kind, providerOrgRef: t.providerOrgRef, occurredAt: iso(t.occurredAt), dwellMs: t.dwellMs });
let AttributionService = class AttributionService {
    prisma;
    policies;
    flags;
    outbox;
    consents;
    fraud;
    links;
    constructor(prisma, policies, flags, outbox, consents, fraud, links) {
        this.prisma = prisma;
        this.policies = policies;
        this.flags = flags;
        this.outbox = outbox;
        this.consents = consents;
        this.fraud = fraud;
        this.links = links;
    }
    onModuleInit() { for (const t of exports.ATTRIBUTION_INTERNAL_EVENTS)
        this.outbox.register(t, async () => undefined); }
    async decideForBooking(i) {
        const market = i.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const booking = await this.prisma.bookingIntent.findUnique({ where: { id: i.bookingId }, select: { id: true, sub: true, providerId: true, clinicId: true, clinicianId: true, tenantId: true, channel: true, createdAt: true } });
        if (!booking)
            throw (0, growth_errors_1.growthError)('GROWTH_EVIDENCE_NOT_FOUND', 'Booking not found');
        const orgId = booking.tenantId ?? (await this.prisma.provider.findUnique({ where: { id: booking.providerId }, select: { tenantId: true } }))?.tenantId ?? '';
        let on;
        try {
            on = await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.ATTRIBUTION, { market, ...(orgId ? { orgId } : {}) });
        }
        catch (e) {
            (0, growth_failures_1.recordGrowthFailure)(growth_failures_1.GROWTH_FAILURE.ATTRIBUTION_FLAG_CHECK);
            throw e;
        }
        if (!on)
            return null;
        const { policy, payload } = await this.policies.decisionPolicy(market, booking.createdAt);
        const existing = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId: booking.id, policyVersionId: policy.versionId, supersedesId: null } });
        if (existing)
            return this.stored(existing, false);
        const touches = await this.touchesFor(booking, i.visitorKey ?? null, policy, market);
        const lt = i.ltToken ? (0, link_token_1.verifyAnyLinkToken)({ kxl1: (0, growth_secrets_1.linkTokenKey)(), provider: (0, growth_secrets_1.providerLinkTouchSecret)() }, i.ltToken, booking.createdAt.getTime()) : null;
        const ltValid = !!(lt && lt.ok && orgId && lt.claims.org === orgId && ['REGISTERED', 'KNOWN'].includes(await this.links.confirm(lt.claims.code, lt.claims.org, market)));
        const input = { id: booking.id, orgId, clinicId: booking.clinicId, doctorId: booking.clinicianId, createdAt: iso(booking.createdAt), channel: booking.channel, ltValidForOrg: ltValid };
        const d = (0, decide_1.decide)(input, touches.map(asTouch), policy);
        const row = await this.persist(booking.id, booking.sub, market, input, d, policy, payload, touches);
        if (row.created)
            await this.fraud.onDecision(orgId);
        return row;
    }
    async touchesFor(b, visitorKey, policy, market) {
        const or = [{ sub: b.sub }];
        if (visitorKey)
            or.push({ visitorKey });
        const rows = await this.prisma.growthTouchpoint.findMany({
            where: { market, OR: or, occurredAt: { lt: b.createdAt, gte: new Date(b.createdAt.getTime() - (0, decide_1.maxWindowMs)(policy)) } },
            orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }], take: 500,
        });
        const codes = [...new Set(rows.map((t) => t.linkCode).filter((c) => !!c))];
        const dead = codes.length ? new Set((await this.prisma.growthAcquisitionSource.findMany({ where: { market, sourceKind: 'PROVIDER_LINK', sourceRef: { in: codes }, linkStatus: { not: 'ACTIVE' } }, select: { sourceRef: true } })).map((x) => x.sourceRef)) : new Set();
        if (dead.size)
            rows.splice(0, rows.length, ...rows.filter((t) => !(t.linkCode && dead.has(t.linkCode))));
        const last = await this.prisma.consentRecord.findFirst({ where: { sub: b.sub, purpose: 'ANALYTICS_MEASUREMENT' }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        return last && !last.granted ? rows.filter((t) => t.occurredAt.getTime() > last.createdAt.getTime()) : rows;
    }
    async persist(bookingId, sub, market, input, d, policy, payload, touches) {
        const kindOf = new Map(touches.map((t) => [t.id, t.kind]));
        try {
            const row = await this.prisma.$transaction(async (tx) => {
                const r = await tx.growthAttributionDecision.create({
                    data: {
                        market, bookingId, origin: d.origin, reasonCode: d.reasonCode, policyVersionId: policy.versionId, inputsHash: d.inputsHash, evidenceTouchIds: d.consideredTouchIds,
                        firstTouchId: d.firstTouchId, lastTouchId: d.lastTouchId, lastNonDirectTouchId: d.lastNonDirectTouchId, winningTouchId: d.winningTouchId,
                        bookingSnapshot: { booking: input, precedence: policy.precedence, policyPayload: payload },
                    },
                });
                await tx.bookingIntent.updateMany({ where: { id: bookingId, attributionDecisionId: null }, data: { acquisitionOrigin: d.origin, attributionDecisionId: r.id } });
                await this.outbox.enqueue(tx, { type: 'AttributionAssigned', aggregateType: 'BookingIntent', aggregateId: bookingId, payload: { bookingId, decisionId: r.id, origin: d.origin, reason: d.reasonCode, policyVersion: policy.versionId, market, decidedAt: r.createdAt.toISOString() }, dedupeKey: `AttributionAssigned:${r.id}` });
                const srcKind = d.winningTouchId ? kindOf.get(d.winningTouchId) ?? 'DIRECT' : input.channel === 'CLINIC_LINK' || input.ltValidForOrg ? 'PROVIDER_LINK' : 'DIRECT';
                await tx.$executeRaw `INSERT INTO "OutboxEvent" ("id","type","aggregateType","aggregateId","target","payload","status","attempts","nextAttemptAt","dedupeKey","createdAt")
          VALUES (${(0, ids_1.newId)('evt')}, 'PatientAcquisitionRecorded', 'Patient', ${(0, privacy_hash_1.subRefOf)(sub)}, 'INTERNAL', ${JSON.stringify({ origin: d.origin, sourceKind: srcKind, market, recordedAt: r.createdAt.toISOString() })}::jsonb, 'PENDING', 0, now(), ${`PatientAcquisitionRecorded:${(0, privacy_hash_1.subRefOf)(sub)}`}, now())
          ON CONFLICT ("dedupeKey") DO NOTHING`;
                return r;
            });
            return this.stored(row, true);
        }
        catch (e) {
            if (e.code === 'P2002') {
                const won = await this.prisma.growthAttributionDecision.findFirst({ where: { bookingId, policyVersionId: policy.versionId, supersedesId: null } });
                if (won)
                    return this.stored(won, false);
            }
            throw e;
        }
    }
    stored(r, created) {
        return { id: r.id, bookingId: r.bookingId, origin: r.origin, reasonCode: r.reasonCode, policyVersionId: r.policyVersionId, inputsHash: r.inputsHash, created };
    }
    async latest(bookingId) { return this.latestIn(this.prisma, bookingId); }
    async latestIn(db, bookingId) {
        const rows = await db.growthAttributionDecision.findMany({ where: { bookingId }, orderBy: [{ createdAt: 'asc' }, { id: 'asc' }] });
        const superseded = new Set(rows.map((r) => r.supersedesId).filter(Boolean));
        return rows.filter((r) => !superseded.has(r.id)).pop() ?? null;
    }
    async acquisitionBlock(bookingId) {
        const d = await this.latest(bookingId);
        if (!d)
            return null;
        const winner = d.winningTouchId ? await this.prisma.growthTouchpoint.findUnique({ where: { id: d.winningTouchId }, select: { kind: true, linkCode: true, sourceId: true, occurredAt: true } }) : null;
        return { origin: d.origin, decisionId: d.id, policyVersion: d.policyVersionId, reason: d.reasonCode, evidenceHash: d.inputsHash, ...(winner ? { touch: { kind: winner.kind, ref: winner.linkCode ?? winner.kind, at: iso(winner.occurredAt) } } : {}) };
    }
    async correct(actor, bookingId, c) {
        if (!actor.roles.includes('super_admin'))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
        if (!contracts_1.ACQUISITION_ORIGINS.includes(c.origin))
            throw (0, errors_1.badRequest)('INVALID_ORIGIN', 'origin must be PROVIDER_LED, MARKETPLACE or UNATTRIBUTED');
        if (!c.note || c.note.trim().length < 10)
            throw (0, errors_1.badRequest)('NOTE_REQUIRED', 'A reason of at least 10 characters is required for an override');
        const row = await this.prisma.$transaction(async (tx) => {
            await tx.$queryRaw `SELECT "id" FROM "BookingIntent" WHERE "id" = ${bookingId} FOR UPDATE`;
            const cur = await this.latestIn(tx, bookingId);
            if (!cur)
                throw (0, growth_errors_1.growthError)('GROWTH_EVIDENCE_NOT_FOUND', 'No decision exists for this booking');
            if (cur.origin === 'PROVIDER_LED' && c.origin !== 'PROVIDER_LED')
                throw (0, errors_1.forbidden)('CORRECTION_CANNOT_ADD_FEE', 'Evidence can only remove a fee, never add one: a provider-led decision cannot be turned into a chargeable one');
            if (cur.origin === c.origin)
                throw (0, errors_1.badRequest)('NO_CHANGE', 'The decision already has this origin');
            const r = await tx.growthAttributionDecision.create({ data: { market: cur.market, bookingId, origin: c.origin, reasonCode: 'MANUAL_CORRECTION', policyVersionId: cur.policyVersionId, inputsHash: cur.inputsHash, evidenceTouchIds: cur.evidenceTouchIds, firstTouchId: cur.firstTouchId, lastTouchId: cur.lastTouchId, lastNonDirectTouchId: cur.lastNonDirectTouchId, winningTouchId: cur.winningTouchId, bookingSnapshot: cur.bookingSnapshot, supersedesId: cur.id, actor: actor.sub, note: c.note.trim().slice(0, 500) } });
            await tx.bookingIntent.updateMany({ where: { id: bookingId }, data: { acquisitionOrigin: c.origin, attributionDecisionId: r.id } });
            await tx.auditLog.create({ data: { actor: actor.sub, action: 'growth.attribution.correct', resource: 'GrowthAttributionDecision', resourceId: r.id, metadata: { bookingId, from: cur.origin, to: c.origin, supersedes: cur.id } } });
            await this.outbox.enqueue(tx, { type: 'AttributionAssigned', aggregateType: 'BookingIntent', aggregateId: bookingId, payload: { bookingId, decisionId: r.id, origin: c.origin, reason: 'MANUAL_CORRECTION', policyVersion: cur.policyVersionId, market: cur.market, decidedAt: r.createdAt.toISOString() }, dedupeKey: `AttributionAssigned:${r.id}` });
            return r;
        }, { maxWait: 10_000, timeout: 20_000 }).catch((e) => {
            if (e.code === 'P2002' && JSON.stringify(e.meta ?? '').includes('GrowthAttributionDecision_one_correction_idx'))
                throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'The decision was corrected concurrently: reload and retry');
            throw e;
        });
        return this.stored(row, true);
    }
    async replay(decisionId) {
        const d = await this.prisma.growthAttributionDecision.findUnique({ where: { id: decisionId } });
        if (!d)
            throw (0, growth_errors_1.growthError)('GROWTH_EVIDENCE_NOT_FOUND', 'Decision not found');
        if (d.supersedesId || !d.bookingSnapshot)
            return { matches: true, skipped: true, reason: 'CORRECTION_OR_NO_SNAPSHOT' };
        const snap = d.bookingSnapshot;
        const touches = await this.prisma.growthTouchpoint.findMany({ where: { id: { in: d.evidenceTouchIds } } });
        const again = (0, decide_1.decide)(snap.booking, touches.map(asTouch), (0, policy_1.toDecisionPolicy)(d.policyVersionId, snap.policyPayload));
        const matches = again.origin === d.origin && again.reasonCode === d.reasonCode && again.inputsHash === d.inputsHash && (again.winningTouchId ?? null) === (d.winningTouchId ?? null);
        return { matches, skipped: false, stored: { origin: d.origin, reasonCode: d.reasonCode, inputsHash: d.inputsHash }, replayed: { origin: again.origin, reasonCode: again.reasonCode, inputsHash: again.inputsHash } };
    }
};
exports.AttributionService = AttributionService;
exports.AttributionService = AttributionService = __decorate([
    (0, common_1.Injectable)(),
    __param(4, (0, common_1.Inject)((0, common_1.forwardRef)(() => patient_public_1.ConsentService))),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, policy_1.AttributionPolicyResolver, control_plane_public_1.FlagsService, outbox_public_1.OutboxService,
        patient_public_1.ConsentService, touch_rules_1.FraudSignalService, link_registry_service_1.LinkRegistryService])
], AttributionService);
//# sourceMappingURL=attribution.service.js.map