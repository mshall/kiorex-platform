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
exports.ExperimentService = exports.EXPERIMENT_EVENTS = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const outbox_public_1 = require("../../outbox/outbox-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const experiment_dto_1 = require("./experiment-dto");
const experiment_types_1 = require("./experiment.types");
const surfaces_1 = require("./surfaces");
const safety_tokens_1 = require("./safety-tokens");
exports.EXPERIMENT_EVENTS = ['ExperimentStarted', 'ExperimentStopped', 'ExperimentConcluded', 'ExperimentSrmDetected', 'ExperimentShipRequested'];
let ExperimentService = class ExperimentService {
    prisma;
    flags;
    outbox;
    log = new common_1.Logger('experiments');
    constructor(prisma, flags, outbox) {
        this.prisma = prisma;
        this.flags = flags;
        this.outbox = outbox;
    }
    onModuleInit() { for (const t of exports.EXPERIMENT_EVENTS)
        this.outbox.register(t, async () => undefined); }
    pub(row) { const { salt: _salt, ...rest } = row; return rest; }
    async must(id, tx = this.prisma) { const e = await tx.growthExperiment.findUnique({ where: { id } }); if (!e)
        throw (0, errors_1.notFound)('EXPERIMENT_NOT_FOUND', 'Experiment not found'); return e; }
    async event(tx, id, kind, actor, reason, diff = {}) { await tx.growthExperimentEvent.create({ data: { experimentId: id, kind, actor, reason: reason ?? null, diff: diff } }); }
    async audit(tx, actor, action, id, metadata) { await tx.auditLog.create({ data: { actor, action: `growth.experiment.${action}`, resource: 'GrowthExperiment', resourceId: id, metadata: metadata } }); }
    checkDesign(d) {
        const tokens = (0, safety_tokens_1.safetyTokens)();
        if (d.surface !== undefined) {
            const s = (0, surfaces_1.assertSurfaceAllowed)(d.surface, [], tokens);
            if (d.primaryMetric) {
                const m = (0, experiment_types_1.metricByKey)(d.primaryMetric);
                if (m.unit === 'BOOKING' && !s.units.includes('SUB') && !s.units.includes('VISITOR'))
                    throw new errors_1.ApiError(400, 'EXPERIMENT_INVALID', 'primary metric does not fit the surface');
            }
            if (d.eligibility?.platforms?.some((p) => !s.platforms.includes(p)))
                throw new errors_1.ApiError(400, 'EXPERIMENT_INVALID', `surface ${s.key} is not on every platform you selected`);
        }
        if (d.flagKey)
            (0, surfaces_1.assertFlagKeyAllowed)(d.flagKey, tokens);
    }
    async create(actor, body) {
        const d = (0, experiment_dto_1.parseDraft)(body);
        this.checkDesign(d);
        const market = d.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const exists = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market, key: d.key } } });
        if (exists)
            throw (0, errors_1.conflict)('EXPERIMENT_KEY_TAKEN', 'An experiment with this key already exists in this market');
        return this.prisma.$transaction(async (tx) => {
            const row = await tx.growthExperiment.create({ data: {
                    market, key: d.key, name: d.name, surface: d.surface, hypothesis: d.hypothesis, variants: d.variants, allocationBp: d.allocationBp ?? 10000, eligibility: (d.eligibility ?? {}),
                    primaryMetric: d.primaryMetric, guardrails: (d.guardrails ?? []), mode: d.mode ?? 'FIXED', alphaBp: d.alphaBp ?? 500, minSample: (0, experiment_dto_1.plannedSample)(d), plannedDays: d.plannedDays ?? 14,
                    salt: (0, node_crypto_1.randomBytes)(16).toString('hex'), createdBy: actor.sub, flagKey: d.flagKey ?? null,
                } });
            await this.event(tx, row.id, 'CREATED', actor.sub, null, { key: row.key, surface: row.surface, variants: d.variants, allocationBp: row.allocationBp, primaryMetric: row.primaryMetric, mode: row.mode, minSample: row.minSample });
            await this.audit(tx, actor.sub, 'create', row.id, { key: row.key, surface: row.surface });
            return this.pub(row);
        });
    }
    async update(actor, id, body) {
        const cur = await this.must(id);
        if (cur.status !== 'DRAFT')
            throw (0, errors_1.conflict)('EXPERIMENT_NOT_EDITABLE', `A ${cur.status} experiment cannot be edited (design is frozen once submitted)`);
        const d = (0, experiment_dto_1.parseDraft)(body, true);
        if ('key' in d && d.key !== cur.key)
            throw new errors_1.ApiError(400, 'EXPERIMENT_INVALID', 'key cannot change');
        this.checkDesign({ ...d, surface: d.surface ?? cur.surface, primaryMetric: d.primaryMetric ?? cur.primaryMetric });
        const diff = {};
        const data = {};
        for (const k of ['name', 'surface', 'hypothesis', 'allocationBp', 'primaryMetric', 'mode', 'alphaBp', 'plannedDays', 'flagKey'])
            if (d[k] !== undefined) {
                data[k] = d[k];
                diff[k] = { from: cur[k], to: d[k] };
            }
        if (d.variants) {
            data.variants = d.variants;
            diff.variants = { from: cur.variants, to: d.variants };
        }
        if (d.eligibility) {
            data.eligibility = d.eligibility;
            diff.eligibility = { from: cur.eligibility, to: d.eligibility };
        }
        if (d.guardrails) {
            data.guardrails = d.guardrails;
            diff.guardrails = { from: cur.guardrails, to: d.guardrails };
        }
        if (d.minSample !== undefined || (d.baselineRate && d.mdeAbs)) {
            data.minSample = (0, experiment_dto_1.plannedSample)({ ...d, alphaBp: d.alphaBp ?? cur.alphaBp });
            diff.minSample = { from: cur.minSample, to: data.minSample };
        }
        return this.prisma.$transaction(async (tx) => { const row = await tx.growthExperiment.update({ where: { id }, data }); await this.event(tx, id, 'EDITED', actor.sub, null, diff); await this.audit(tx, actor.sub, 'update', id, { fields: Object.keys(diff) }); return this.pub(row); });
    }
    async submit(actor, id) {
        const cur = await this.must(id);
        if (cur.status !== 'DRAFT')
            throw (0, errors_1.conflict)('EXPERIMENT_INVALID_TRANSITION', `Only a DRAFT can be submitted (this one is ${cur.status})`);
        this.checkDesign({ surface: cur.surface, flagKey: cur.flagKey ?? undefined });
        return this.prisma.$transaction(async (tx) => { const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'PENDING_APPROVAL' } }); await this.event(tx, id, 'SUBMITTED', actor.sub); await this.audit(tx, actor.sub, 'submit', id, {}); return this.pub(row); });
    }
    async approveAndStart(actor, id, now = new Date()) {
        const cur = await this.must(id);
        if (cur.status !== 'PENDING_APPROVAL')
            throw (0, errors_1.conflict)('EXPERIMENT_INVALID_TRANSITION', `Only a PENDING_APPROVAL experiment can be started (this one is ${cur.status})`);
        if (cur.createdBy === actor.sub)
            throw (0, errors_1.forbidden)('SECOND_APPROVER_REQUIRED', 'Two-person rule: the author of an experiment cannot approve it');
        if (!(await this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.EXPERIMENTS, { market: cur.market })))
            throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'growth.experiments is OFF', { key: growth_flags_1.GROWTH_FLAG.EXPERIMENTS });
        this.checkDesign({ surface: cur.surface, flagKey: cur.flagKey ?? undefined });
        const row = await this.prisma.$transaction(async (tx) => {
            await tx.$executeRaw `SELECT pg_advisory_xact_lock(hashtext(${`exp:${cur.market}:${cur.surface}`}))`;
            const running = await tx.growthExperiment.count({ where: { market: cur.market, surface: cur.surface, status: 'RUNNING' } });
            if (running >= experiment_types_1.EXPERIMENT_POLICY.maxConcurrentPerSurface)
                throw (0, errors_1.conflict)('EXPERIMENT_SURFACE_BUSY', 'Another experiment is already running on this surface in this market', { surface: cur.surface });
            const r = await tx.growthExperiment.update({ where: { id }, data: { status: 'RUNNING', approvedBy: actor.sub, startedAt: now } });
            await this.event(tx, id, 'APPROVED', actor.sub);
            await this.event(tx, id, 'STARTED', actor.sub, null, { startedAt: now.toISOString(), allocationBp: cur.allocationBp, variants: cur.variants });
            await this.audit(tx, actor.sub, 'start', id, { surface: cur.surface });
            await this.outbox.enqueue(tx, { type: 'ExperimentStarted', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, market: cur.market, key: cur.key, surface: cur.surface, at: now.toISOString() }, dedupeKey: `ExperimentStarted:${id}` });
            return r;
        });
        return this.pub(row);
    }
    async stop(actor, id, reason, now = new Date(), kind = 'MANUAL') {
        if (typeof reason !== 'string' || reason.trim().length < 3)
            throw new errors_1.ApiError(400, 'EXPERIMENT_INVALID', 'A stop reason of at least 3 characters is required');
        return this.prisma.$transaction(async (tx) => {
            const cur = await this.must(id, tx);
            if (cur.status !== 'RUNNING')
                throw (0, errors_1.conflict)('EXPERIMENT_INVALID_TRANSITION', `Only a RUNNING experiment can be stopped (this one is ${cur.status})`);
            const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'STOPPED', stoppedAt: now, stopReason: reason.trim().slice(0, 200) } });
            await this.event(tx, id, 'STOPPED', actor.sub, reason.trim().slice(0, 200), { by: kind });
            await this.audit(tx, actor.sub, 'stop', id, { reason: reason.slice(0, 200), by: kind });
            await this.outbox.enqueue(tx, { type: 'ExperimentStopped', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, market: cur.market, key: cur.key, reason: reason.slice(0, 200), by: kind, at: now.toISOString() }, dedupeKey: `ExperimentStopped:${id}` });
            return this.pub(row);
        });
    }
    async conclude(actor, id, verdict, now = new Date()) {
        return this.prisma.$transaction(async (tx) => {
            const cur = await this.must(id, tx);
            if (cur.status !== 'RUNNING')
                throw (0, errors_1.conflict)('EXPERIMENT_INVALID_TRANSITION', `Only a RUNNING experiment can be concluded (this one is ${cur.status})`);
            const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'CONCLUDED', stoppedAt: now, stopReason: `CONCLUDED:${verdict}` } });
            await this.event(tx, id, 'CONCLUDED', actor.sub, verdict, {});
            await this.outbox.enqueue(tx, { type: 'ExperimentConcluded', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, market: cur.market, key: cur.key, verdict, at: now.toISOString() }, dedupeKey: `ExperimentConcluded:${id}` });
            return this.pub(row);
        });
    }
    async archive(actor, id) {
        return this.prisma.$transaction(async (tx) => {
            const cur = await this.must(id, tx);
            if (cur.status === 'RUNNING' || cur.status === 'PENDING_APPROVAL')
                throw (0, errors_1.conflict)('EXPERIMENT_INVALID_TRANSITION', `Stop the experiment before archiving it (it is ${cur.status})`);
            if (cur.status === 'ARCHIVED')
                return this.pub(cur);
            const row = await tx.growthExperiment.update({ where: { id }, data: { status: 'ARCHIVED' } });
            await this.event(tx, id, 'ARCHIVED', actor.sub);
            await this.audit(tx, actor.sub, 'archive', id, {});
            return this.pub(row);
        });
    }
    async shipWinner(actor, id) {
        return this.prisma.$transaction(async (tx) => {
            const cur = await this.must(id, tx);
            if (cur.status !== 'CONCLUDED')
                throw (0, errors_1.conflict)('EXPERIMENT_NOT_SHIPPABLE', 'Only a CONCLUDED experiment can be shipped');
            const last = await tx.growthExperimentResult.findFirst({ where: { experimentId: id }, orderBy: { computedAt: 'desc' } });
            const payload = (last?.payload ?? {});
            if (last?.verdict !== 'WINNER' || !payload.winner)
                throw (0, errors_1.conflict)('EXPERIMENT_NOT_SHIPPABLE', 'The latest result is not a WINNER');
            const already = await tx.growthExperimentEvent.findFirst({ where: { experimentId: id, kind: 'SHIP_REQUESTED' } });
            if (already)
                return { requested: true, duplicate: true, proposal: already.diff };
            const proposal = { winner: payload.winner, flagKey: cur.flagKey, surface: cur.surface, nextStep: cur.flagKey ? 'Change the flag in the Super Admin (flag change goes through the control-plane audit)' : 'Create a Growth config version draft or ship the copy in code; both need a second person', autoApplied: false };
            await this.event(tx, id, 'SHIP_REQUESTED', actor.sub, null, proposal);
            await this.audit(tx, actor.sub, 'ship_requested', id, proposal);
            await this.outbox.enqueue(tx, { type: 'ExperimentShipRequested', aggregateType: 'GrowthExperiment', aggregateId: id, payload: { experimentId: id, ...proposal }, dedupeKey: `ExperimentShipRequested:${id}` });
            return { requested: true, duplicate: false, proposal };
        });
    }
    async list(f = {}) {
        return (await this.prisma.growthExperiment.findMany({ where: { market: f.market, status: f.status, surface: f.surface }, orderBy: { createdAt: 'desc' }, take: Math.min(Math.max(f.take ?? 100, 1), 200) })).map((e) => this.pub(e));
    }
    async get(id) {
        const e = await this.must(id);
        const [latest, events] = await Promise.all([
            this.prisma.growthExperimentResult.findFirst({ where: { experimentId: id }, orderBy: { computedAt: 'desc' } }),
            this.prisma.growthExperimentEvent.findMany({ where: { experimentId: id }, orderBy: { at: 'asc' }, take: 500 }),
        ]);
        return { ...this.pub(e), latestResult: latest ? this.redact(latest, e.status) : null, events };
    }
    history(id) { return this.prisma.growthExperimentEvent.findMany({ where: { experimentId: id }, orderBy: { at: 'asc' }, take: 1000 }); }
    async results(id) { const e = await this.must(id); return (await this.prisma.growthExperimentResult.findMany({ where: { experimentId: id }, orderBy: { computedAt: 'desc' }, take: 200 })).map((r) => this.redact(r, e.status)); }
    redact(r, _status) {
        const p = (r.payload ?? {});
        const k = experiment_types_1.EXPERIMENT_POLICY.kAnonymity;
        const arms = p.arms?.map((a) => (a.n < k ? { variant: a.variant, n: '<10', x: '<10', rate: null } : a));
        if (r.verdict === 'SRM_DETECTED' || r.verdict === 'COLLECTING' || p.hidden) {
            const { srm, blockers, dayNumber } = (r.payload ?? {});
            return { ...r, payload: { hidden: true, arms, srm, blockers, dayNumber } };
        }
        return { ...r, payload: { ...p, arms } };
    }
};
exports.ExperimentService = ExperimentService;
exports.ExperimentService = ExperimentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, outbox_public_1.OutboxService])
], ExperimentService);
//# sourceMappingURL=experiment.service.js.map