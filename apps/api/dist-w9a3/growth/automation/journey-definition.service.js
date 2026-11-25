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
exports.JourneyDefinitionService = exports.invalid = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const automation_flags_1 = require("./automation-flags");
const journey_compiler_1 = require("./journey.compiler");
const journey_dryrun_1 = require("./journey.dryrun");
const journey_graph_1 = require("./journey.graph");
const journey_validator_1 = require("./journey.validator");
const lifecycle_segments_1 = require("../lifecycle/lifecycle-segments");
const lifecycle_policy_service_1 = require("../lifecycle/lifecycle-policy.service");
const KEY = /^[a-z0-9][a-z0-9-]{1,47}$/;
const invalid = (errors) => new errors_1.ApiError(422, 'JOURNEY_INVALID', 'The journey graph is not valid', { errors });
exports.invalid = invalid;
let JourneyDefinitionService = class JourneyDefinitionService {
    prisma;
    flags;
    policies;
    constructor(prisma, flags, policies) {
        this.prisma = prisma;
        this.flags = flags;
        this.policies = policies;
    }
    catalog() {
        return {
            nodeTypes: ['TRIGGER', 'WAIT', 'CONDITION', 'SEND', 'BRANCH_EXPERIMENT', 'END'], triggers: journey_graph_1.TRIGGER_EVENTS, channels: journey_graph_1.CHANNELS, attributes: lifecycle_segments_1.SEGMENT_ATTRIBUTES, branchSurface: journey_graph_1.BRANCH_SURFACE, policy: journey_graph_1.AUTOMATION_POLICY,
            templates: journey_graph_1.SEND_TEMPLATES.map((t) => ({ key: t, messageClass: (0, journey_validator_1.templateClass)(t), channels: (0, journey_validator_1.allowedChannels)(t) })),
        };
    }
    async status(market = growth_flags_1.GROWTH_DEFAULT_MARKET) {
        const [auto, marketing] = await Promise.all([this.flags.evaluate(automation_flags_1.AUTOMATION_FLAG, { market }), this.flags.evaluate(growth_flags_1.GROWTH_FLAG.MARKETING_MESSAGING, { market })]);
        return { market, automation: { effective: auto.effective, reason: auto.reason }, marketingLicence: { effective: marketing.effective, reason: marketing.reason, flag: growth_flags_1.GROWTH_FLAG.MARKETING_MESSAGING }, lifecycleJourneys: await this.policies.journeysOn(market) };
    }
    async must(id) { const r = await this.prisma.lifecycleJourneyDefinition.findUnique({ where: { id } }); if (!r)
        throw (0, errors_1.notFound)('JOURNEY_NOT_FOUND', 'No such journey'); return r; }
    audit(tx, actor, action, id, metadata) {
        return tx.auditLog.create({ data: { actor: actor.sub, action: `growth.automation.${action}`, resource: 'LifecycleJourneyDefinition', resourceId: id, metadata: metadata } });
    }
    present(r) {
        return { id: r.id, market: r.market, key: r.key, version: r.version, status: r.status, name: r.name, graph: r.graph, checksum: r.checksum, createdBy: r.createdBy, approvedBy: r.approvedBy, submittedAt: r.submittedAt, publishedAt: r.publishedAt, retiredAt: r.retiredAt, killedAt: r.killedAt, killedBy: r.killedBy, killReason: r.killReason, createdAt: r.createdAt };
    }
    preview(graph, o = {}) {
        const v = (0, journey_validator_1.validateGraph)(graph);
        if (!v.valid)
            return { valid: false, errors: v.errors };
        const c = (0, journey_compiler_1.compileGraph)(v.graph, { definitionId: 'preview', market: o.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET, key: o.key ?? 'preview', version: 0 });
        return { valid: true, errors: [], checksum: c.checksum, compiled: this.view(c) };
    }
    view(c) { return { steps: c.steps, gateNodes: c.gateNodes, truncated: c.truncated, trigger: c.trigger, key: c.def.key }; }
    async dryRunGraph(graph, market, o = {}) {
        const v = (0, journey_validator_1.validateGraph)(graph);
        if (!v.valid)
            throw (0, exports.invalid)(v.errors);
        const c = (0, journey_compiler_1.compileGraph)(v.graph, { definitionId: 'dry-run', market, key: 'dry-run', version: 0 });
        const marketingFlagOn = await this.policies.marketingOn(market);
        const policy = await this.policies.resolve(market);
        return { checksum: c.checksum, compiled: this.view(c), result: (0, journey_dryrun_1.dryRun)(c, { ...o, marketingFlagOn, holdoutBps: policy.holdoutBps, caps: policy.caps, quiet: policy.quiet }) };
    }
    async dryRunSaved(id, o = {}) { const r = await this.must(id); return { id, ...(await this.dryRunGraph(r.graph, r.market, o)) }; }
    async create(actor, body) {
        const key = typeof body.key === 'string' ? body.key : '';
        if (!KEY.test(key))
            throw new errors_1.ApiError(400, 'JOURNEY_KEY_INVALID', 'key must match [a-z0-9][a-z0-9-]{1,47}');
        const name = typeof body.name === 'string' ? body.name.trim().slice(0, 120) : '';
        const market = typeof body.market === 'string' && /^[A-Z]{2}$/.test(body.market) ? body.market : growth_flags_1.GROWTH_DEFAULT_MARKET;
        const v = (0, journey_validator_1.validateGraph)(body.graph);
        if (!v.valid)
            throw (0, exports.invalid)(v.errors);
        const open = await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market, key, status: { in: ['DRAFT', 'PENDING_APPROVAL'] } } });
        if (open)
            throw (0, errors_1.conflict)('JOURNEY_DRAFT_EXISTS', 'This journey already has an open draft; edit or reject it first');
        const last = await this.prisma.lifecycleJourneyDefinition.findFirst({ where: { market, key }, orderBy: { version: 'desc' }, select: { version: true } });
        const row = await this.prisma.$transaction(async (tx) => {
            const r = await tx.lifecycleJourneyDefinition.create({ data: { market, key, version: (last?.version ?? 0) + 1, name, graph: v.graph, checksum: (0, journey_graph_1.checksumOf)(v.graph), createdBy: actor.sub } });
            await this.audit(tx, actor, 'create', r.id, { key, version: r.version, checksum: r.checksum });
            return r;
        });
        return this.present(row);
    }
    async update(actor, id, body) {
        const cur = await this.must(id);
        if (cur.status !== 'DRAFT')
            throw (0, errors_1.conflict)('JOURNEY_NOT_EDITABLE', 'Only a draft can be edited; a published journey is immutable (make a new version)');
        if (cur.createdBy !== actor.sub)
            throw (0, errors_1.forbidden)('JOURNEY_AUTHOR_ONLY', 'Only the author edits a draft');
        const data = {};
        if (body.graph !== undefined) {
            const v = (0, journey_validator_1.validateGraph)(body.graph);
            if (!v.valid)
                throw (0, exports.invalid)(v.errors);
            data.graph = v.graph;
            data.checksum = (0, journey_graph_1.checksumOf)(v.graph);
        }
        if (typeof body.name === 'string')
            data.name = body.name.trim().slice(0, 120);
        const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data }); await this.audit(tx, actor, 'update', id, { checksum: r.checksum }); return r; });
        return this.present(row);
    }
    async assertBranchExperiments(graph, market) {
        for (const n of graph.nodes)
            if (n.type === 'BRANCH_EXPERIMENT') {
                const e = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market, key: n.experiment } }, select: { surface: true, status: true, variants: true } });
                if (!e || e.surface !== journey_graph_1.BRANCH_SURFACE)
                    throw new errors_1.ApiError(422, 'JOURNEY_INVALID', 'The journey graph is not valid', { errors: [{ code: 'BRANCH_INVALID', path: `/nodes/${n.id}/experiment`, message: `experiment "${n.experiment}" does not exist on the surface ${journey_graph_1.BRANCH_SURFACE}` }] });
                const have = new Set((e.variants ?? []).map((x) => x.key));
                for (const ed of graph.edges.filter((x) => x.from === n.id))
                    if (!have.has(ed.label))
                        throw new errors_1.ApiError(422, 'JOURNEY_INVALID', 'The journey graph is not valid', { errors: [{ code: 'BRANCH_INVALID', path: `/edges`, message: `variant "${ed.label}" is not a variant of experiment "${n.experiment}"` }] });
            }
    }
    async submit(actor, id) {
        const cur = await this.must(id);
        if (cur.status !== 'DRAFT')
            throw (0, errors_1.conflict)('JOURNEY_INVALID_TRANSITION', 'Only a draft can be submitted');
        const v = (0, journey_validator_1.validateGraph)(cur.graph);
        if (!v.valid)
            throw (0, exports.invalid)(v.errors);
        await this.assertBranchExperiments(v.graph, cur.market);
        const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'PENDING_APPROVAL', submittedAt: new Date() } }); await this.audit(tx, actor, 'submit', id, { checksum: r.checksum }); return r; });
        return this.present(row);
    }
    async reject(actor, id, reason) {
        const cur = await this.must(id);
        if (cur.status !== 'PENDING_APPROVAL')
            throw (0, errors_1.conflict)('JOURNEY_INVALID_TRANSITION', 'Only a pending journey can be rejected');
        if (cur.createdBy === actor.sub)
            throw (0, errors_1.forbidden)('JOURNEY_TWO_PERSON_RULE', 'The author cannot decide their own journey');
        const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'DRAFT', submittedAt: null } }); await this.audit(tx, actor, 'reject', id, { reason: reason.slice(0, 300) }); return r; });
        return this.present(row);
    }
    async approve(actor, id, now = new Date()) {
        const cur = await this.must(id);
        if (cur.status !== 'PENDING_APPROVAL')
            throw (0, errors_1.conflict)('JOURNEY_INVALID_TRANSITION', 'Only a pending journey can be approved');
        if (cur.createdBy === actor.sub)
            throw (0, errors_1.forbidden)('JOURNEY_TWO_PERSON_RULE', 'A different person must approve (two-person rule)');
        const v = (0, journey_validator_1.validateGraph)(cur.graph);
        if (!v.valid)
            throw (0, exports.invalid)(v.errors);
        await this.assertBranchExperiments(v.graph, cur.market);
        const hasMarketing = v.graph.nodes.some((n) => n.type === 'SEND' && (0, journey_validator_1.templateClass)(n.template) === 'MARKETING');
        const status = await this.status(cur.market);
        const row = await this.prisma.$transaction(async (tx) => {
            await tx.lifecycleJourneyDefinition.updateMany({ where: { market: cur.market, key: cur.key, status: 'PUBLISHED' }, data: { status: 'RETIRED', retiredAt: now } });
            const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'PUBLISHED', approvedBy: actor.sub, publishedAt: now } });
            await this.audit(tx, actor, 'publish', id, { key: cur.key, version: cur.version, checksum: cur.checksum, marketingFlagEffective: status.marketingLicence.effective });
            return r;
        });
        return { ...this.present(row), warnings: hasMarketing && !status.marketingLicence.effective ? ['MARKETING_FLAG_OFF'] : [] };
    }
    async retire(actor, id, now = new Date()) {
        const cur = await this.must(id);
        if (cur.status !== 'PUBLISHED')
            throw (0, errors_1.conflict)('JOURNEY_INVALID_TRANSITION', 'Only a published journey can be retired');
        const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { status: 'RETIRED', retiredAt: now } }); await this.audit(tx, actor, 'retire', id, {}); return r; });
        return this.present(row);
    }
    async kill(actor, id, reason, now = new Date()) {
        const cur = await this.must(id);
        if (cur.status !== 'PUBLISHED')
            throw (0, errors_1.conflict)('JOURNEY_INVALID_TRANSITION', 'Only a published journey can be killed');
        if (!reason || reason.trim().length < 3)
            throw new errors_1.ApiError(400, 'JOURNEY_REASON_REQUIRED', 'A reason is required');
        const row = await this.prisma.$transaction(async (tx) => { const r = await tx.lifecycleJourneyDefinition.update({ where: { id }, data: { killedAt: now, killedBy: actor.sub, killReason: reason.trim().slice(0, 300) } }); await this.audit(tx, actor, 'kill', id, { reason: reason.slice(0, 300) }); return r; });
        return this.present(row);
    }
    async list(f = {}) {
        const rows = await this.prisma.lifecycleJourneyDefinition.findMany({ where: { ...(f.market ? { market: f.market } : {}), ...(f.status ? { status: f.status } : {}) }, orderBy: [{ createdAt: 'desc' }], take: Math.min(f.take ?? 100, 200) });
        return rows.map((r) => this.present(r));
    }
    async get(id) {
        const r = await this.must(id);
        const v = (0, journey_validator_1.validateGraph)(r.graph);
        const logs = await this.prisma.lifecycleJourneyRunLog.findMany({ where: { definitionId: id }, orderBy: { day: 'desc' }, take: 30 });
        const active = await this.prisma.lifecycleEnrollment.count({ where: { state: 'ACTIVE', journeyKey: { startsWith: `auto.${r.market.toLowerCase()}.${r.key}#` }, journeyVersion: r.version } });
        return {
            ...this.present(r), compiled: v.valid ? this.view((0, journey_compiler_1.compileGraph)(v.graph, { definitionId: r.id, market: r.market, key: r.key, version: r.version, name: r.name })) : null, activeEnrolments: active,
            runLog: logs.map((l) => ({ day: l.day.toISOString().slice(0, 10), enrolled: l.enrolled, sent: l.sent, skipped: l.skipped, ended: l.ended, byReason: l.byReason })),
        };
    }
};
exports.JourneyDefinitionService = JourneyDefinitionService;
exports.JourneyDefinitionService = JourneyDefinitionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, lifecycle_policy_service_1.LifecyclePolicyService])
], JourneyDefinitionService);
//# sourceMappingURL=journey-definition.service.js.map