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
exports.GrowthConfigService = exports.LOCAL_CONFIG_KINDS = exports.SEO_EXTENSION_KEYS = exports.DEFAULT_ACTOR = exports.ANNOUNCEMENT_KINDS = exports.MONEY_POLICY_LEAD_MS = exports.MONEY_POLICY_KINDS = void 0;
exports.validateGrowthConfig = validateGrowthConfig;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const seo_public_1 = require("../seo/seo-public");
const fraud_config_1 = require("../fraud/fraud-config");
const seo_automation_config_1 = require("../seo-automation/seo-automation-config");
const ltv_policy_1 = require("../cohorts/ltv-policy");
const market_core_public_1 = require("../../market/market-core-public");
const errors_1 = require("../../common/errors");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_errors_1 = require("../growth-errors");
const growth_secrets_1 = require("../growth-secrets");
const growth_defaults_1 = require("./growth-defaults");
const config_readers_1 = require("./config-readers");
const config_diff_1 = require("../admin/config-diff");
const config_guardrails_1 = require("../admin/config-guardrails");
exports.MONEY_POLICY_KINDS = ['ATTRIBUTION_POLICY', 'COMMISSION', 'SPONSORED_PROMOTION_POLICY'];
exports.MONEY_POLICY_LEAD_MS = 7 * 86_400_000;
exports.ANNOUNCEMENT_KINDS = ['CAMPAIGN_POLICY', 'REFERRAL_RULES', 'REWARD_RULES', 'LIFECYCLE_POLICY', 'ASSISTANT_POLICY'];
exports.DEFAULT_ACTOR = 'system:proposed-default';
exports.SEO_EXTENSION_KEYS = ['templates', 'paginatedIndexable', 'reviewMarkupMinCount', 'sameDayWindowHours', 'minAvailableProviders', 'maxParentSimilarityPercent'];
exports.LOCAL_CONFIG_KINDS = ['LTV_POLICY', 'MARKET_PROFILE'];
function validateGrowthConfig(kind, payload) {
    if (kind === 'LTV_POLICY' || kind === 'MARKET_PROFILE') {
        const errors = kind === 'LTV_POLICY' ? (0, ltv_policy_1.validateLtvPolicy)(payload).errors : (0, market_core_public_1.validateMarketProfile)(payload);
        return errors.length ? { valid: false, errors } : { valid: true, value: payload };
    }
    if (kind === 'FRAUD_RULES' || kind === 'SEO_AUTOMATION') {
        const mine = kind === 'FRAUD_RULES' ? (0, fraud_config_1.validateFraudRules)(payload) : (0, seo_automation_config_1.validateSeoAutomation)(payload);
        const known = contracts_1.GROWTH_CONFIG_KINDS.includes(kind);
        const theirs = known ? (0, contracts_1.validateGrowthConfig)(kind, payload) : { valid: true };
        const errors = [...(theirs.valid ? [] : theirs.errors), ...mine.errors];
        return errors.length ? { valid: false, errors } : { valid: true, value: payload };
    }
    if (kind !== 'SEO' || !payload || typeof payload !== 'object' || Array.isArray(payload))
        return (0, contracts_1.validateGrowthConfig)(kind, payload);
    const base = {};
    const ext = {};
    for (const [k, v] of Object.entries(payload))
        (exports.SEO_EXTENSION_KEYS.includes(k) ? ext : base)[k] = v;
    const a = (0, contracts_1.validateGrowthConfig)(kind, base);
    const b = (0, seo_public_1.validateSeoExtensions)(ext);
    const errors = [...(a.valid ? [] : a.errors), ...b.errors];
    return errors.length ? { valid: false, errors } : { valid: true, value: payload };
}
const checksumOf = (payload) => (0, growth_secrets_1.sha256Hex)((0, contracts_1.growthCanonicalJson)(payload));
const isSuper = (a) => a.roles.includes('super_admin');
let GrowthConfigService = class GrowthConfigService {
    prisma;
    readers;
    cache = new Map();
    constructor(prisma) {
        this.prisma = prisma;
        this.readers = new config_readers_1.ConfigReaders(prisma);
    }
    cacheTtlMs() {
        const raw = process.env.GROWTH_CONFIG_CACHE_TTL_MS;
        const n = raw === undefined || raw === '' ? NaN : Number(raw);
        return Number.isFinite(n) && n >= 0 ? n : process.env.NODE_ENV === 'test' ? 0 : 5000;
    }
    invalidate() { this.cache.clear(); }
    async resolve(kind, o = {}) {
        const ttl = this.cacheTtlMs();
        if (o.at || ttl === 0)
            return this.resolveUncached(kind, o);
        const key = `${kind}|${o.market ?? ''}`;
        const now = Date.now();
        const hit = this.cache.get(key);
        if (hit && hit.until > now) {
            await this.readers.record('config-service', hit.value);
            return hit.value;
        }
        const value = await this.resolveUncached(kind, o);
        const nextDue = await this.prisma.growthConfigVersion.findFirst({ where: { kind, status: 'APPROVED', effectiveFrom: { gt: new Date(now) } }, orderBy: { effectiveFrom: 'asc' }, select: { effectiveFrom: true } });
        const bounds = [now + ttl, nextDue?.effectiveFrom?.getTime() ?? Infinity];
        this.cache.set(key, { until: Math.min(...bounds), value: value });
        return value;
    }
    async resolveUncached(kind, o = {}) {
        const at = o.at ?? new Date();
        if (!o.at || at.getTime() >= Date.now() - 1000)
            await this.activateDue(at);
        const scopes = [...(o.market ? [{ scope: 'MARKET', scopeId: o.market }] : []), { scope: 'GLOBAL', scopeId: '' }];
        for (const s of scopes) {
            const row = await this.prisma.growthConfigVersion.findFirst({
                where: { kind, scope: s.scope, scopeId: s.scopeId ?? '', status: { in: ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'] }, effectiveFrom: { lte: at }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: at } }] },
                orderBy: { effectiveFrom: 'desc' },
            });
            if (row)
                return this.noted(o, this.present(row));
        }
        const def = growth_defaults_1.GROWTH_DEFAULT_PAYLOADS[kind];
        if (!def)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_NOT_FOUND', `No active growth configuration and no default for ${kind}`);
        const row = await this.ensureDefaultRow(kind);
        return this.noted(o, { ...this.present(row), payload: def, source: 'PROPOSED_DEFAULT' });
    }
    async noted(o, r) {
        if (!o.at)
            await this.readers.record('config-service', r);
        return r;
    }
    present(row) {
        return { versionId: row.id, version: row.version, kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: row.payload, source: row.ticket === growth_defaults_1.PROPOSED_DEFAULT_MARKER ? 'PROPOSED_DEFAULT' : 'ACTIVE', effectiveFrom: row.effectiveFrom };
    }
    async ensureDefaultRow(kind) {
        const find = () => this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'GLOBAL', scopeId: '', ticket: growth_defaults_1.PROPOSED_DEFAULT_MARKER, status: { in: ['ACTIVE', 'SUPERSEDED'] } }, orderBy: { version: 'asc' } });
        const existing = await find();
        if (existing)
            return existing;
        const payload = growth_defaults_1.GROWTH_DEFAULT_PAYLOADS[kind];
        for (let attempt = 0; attempt < 3; attempt++) {
            try {
                const next = ((await this.prisma.growthConfigVersion.aggregate({ where: { kind, scope: 'GLOBAL', scopeId: '' }, _max: { version: true } }))._max.version ?? 0) + 1;
                const active = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'GLOBAL', scopeId: '', status: 'ACTIVE' } });
                if (active?.ticket === growth_defaults_1.PROPOSED_DEFAULT_MARKER)
                    return active;
                return await this.prisma.growthConfigVersion.create({ data: { kind, scope: 'GLOBAL', scopeId: '', version: next, status: active ? 'SUPERSEDED' : 'ACTIVE', effectiveTo: active ? (active.effectiveFrom ?? new Date(1)) : null, payload: payload, effectiveFrom: new Date(0), createdBy: exports.DEFAULT_ACTOR, ticket: growth_defaults_1.PROPOSED_DEFAULT_MARKER, reason: 'Code defaults (PROPOSED_DEFAULT) until the first approved version', checksum: checksumOf(payload) } });
            }
            catch (e) {
                if (e.code !== 'P2002')
                    throw e;
                const raced = await find();
                if (raced)
                    return raced;
            }
        }
        throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_NOT_FOUND', `Could not materialise the default ${kind} version`);
    }
    async createDraft(actor, i) {
        if (!isSuper(actor))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
        this.assertKind(i.kind);
        this.assertScope(i);
        const v = validateGrowthConfig(i.kind, i.payload);
        if (!v.valid)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'Payload does not match the schema for this kind', { errors: v.errors });
        if (i.kind === 'MARKET_PROFILE' && (i.scope !== 'MARKET' || i.payload.cc !== i.scopeId))
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'A market profile belongs to its own market scope', { errors: ['/cc must equal the MARKET scopeId'] });
        if (i.kind === 'ATTRIBUTION_POLICY' && i.payload.precedence === 'FIRST_TOUCH')
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'FIRST_TOUCH is reporting only and cannot be the commission precedence', { errors: ['/precedence FIRST_TOUCH is not allowed for commission'] });
        await this.guard({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, ticket: i.ticket }, true);
        const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, createdBy: actor.sub, effectiveFrom: i.effectiveFrom ?? null, ticket: i.ticket, reason: i.reason, announcement: i.announcement, status: 'DRAFT' });
        await this.audit(actor.sub, 'create', row, { after: row.checksum });
        return row;
    }
    async createSystemDraft(i) {
        this.assertKind(i.kind);
        this.assertScope(i);
        const v = validateGrowthConfig(i.kind, i.payload);
        if (!v.valid)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'Payload does not match the schema for this kind', { errors: v.errors });
        const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: i.payload, createdBy: 'system:fraud-calibration', effectiveFrom: null, reason: i.reason, status: 'DRAFT' });
        await this.audit('system:fraud-calibration', 'create', row, { after: row.checksum });
        return row;
    }
    async updateDraft(actor, id, patch) {
        const row = await this.must(id);
        if (row.status !== 'DRAFT')
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a DRAFT can be edited; create a new version instead', { status: row.status });
        if (row.createdBy !== actor.sub)
            throw (0, errors_1.forbidden)('FORBIDDEN_NOT_AUTHOR', 'Only the author can edit a draft');
        if (patch.payload) {
            const v = validateGrowthConfig(row.kind, patch.payload);
            if (!v.valid)
                throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'Payload does not match the schema for this kind', { errors: v.errors });
            await this.guard({ kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: patch.payload, ticket: patch.ticket ?? row.ticket }, false);
        }
        const payload = patch.payload ?? row.payload;
        const next = await this.prisma.growthConfigVersion.update({ where: { id }, data: { payload: payload, checksum: checksumOf(payload), ...(patch.effectiveFrom !== undefined ? { effectiveFrom: patch.effectiveFrom } : {}), ...(patch.ticket !== undefined ? { ticket: patch.ticket } : {}), ...(patch.reason !== undefined ? { reason: patch.reason } : {}), ...(patch.announcement !== undefined ? { announcement: patch.announcement } : {}) } });
        await this.audit(actor.sub, 'update', next, { before: row.checksum, after: next.checksum });
        return next;
    }
    async submit(actor, id, now = new Date()) {
        const row = await this.must(id);
        if (row.status !== 'DRAFT')
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a DRAFT can be submitted', { status: row.status });
        if (row.createdBy !== actor.sub)
            throw (0, errors_1.forbidden)('FORBIDDEN_NOT_AUTHOR', 'Only the author can submit a draft');
        this.assertMoneyPolicy(row, now);
        await this.guard({ kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: row.payload, ticket: row.ticket }, false);
        await this.assertNoOtherPending(row);
        return this.move(actor.sub, 'submit', row, { status: 'PENDING_APPROVAL' }, ['DRAFT']);
    }
    async validate(id, now = new Date()) {
        const row = await this.must(id);
        const errors = [];
        const warnings = [];
        const v = validateGrowthConfig(row.kind, row.payload);
        if (!v.valid)
            errors.push(...v.errors);
        errors.push(...(0, config_guardrails_1.findSecretViolations)(row.payload));
        const current = await this.inForcePayload(row.kind, row.scope, row.scopeId, row.id);
        const g = (0, config_guardrails_1.evaluateGuardrails)({ kind: row.kind, scope: row.scope, scopeId: row.scopeId, payload: row.payload, current, ticket: row.ticket });
        errors.push(...g.errors);
        warnings.push(...g.warnings);
        if (exports.ANNOUNCEMENT_KINDS.includes(row.kind) && (!row.announcement || row.announcement.trim().length < 10))
            errors.push('/announcement: an announcement (10+ characters) is required for this kind');
        if (exports.MONEY_POLICY_KINDS.includes(row.kind)) {
            if (!row.announcement || row.announcement.trim().length < 10)
                errors.push('/announcement: a provider-facing announcement (10+ characters) is required for this kind');
            const min = now.getTime() + exports.MONEY_POLICY_LEAD_MS;
            if (!row.effectiveFrom || row.effectiveFrom.getTime() < min)
                errors.push(`/effectiveFrom: must be at least 7 days after approval (earliest ${new Date(min).toISOString()} if approved now)`);
        }
        return { valid: errors.length === 0, errors, warnings };
    }
    async approve(actor, id, now = new Date()) {
        if (!isSuper(actor))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
        const row = await this.must(id);
        if (row.status !== 'PENDING_APPROVAL')
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a version waiting for approval can be approved', { status: row.status });
        if (row.createdBy === actor.sub)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_SELF_APPROVAL', 'The approver must be a different super admin than the author');
        this.assertMoneyPolicy(row, now);
        const approved = await this.move(actor.sub, 'approve', row, { status: 'APPROVED', approvedBy: actor.sub, approvedAt: now, effectiveFrom: row.effectiveFrom ?? now }, ['PENDING_APPROVAL']);
        await this.activateDue(now);
        return (await this.prisma.growthConfigVersion.findUnique({ where: { id } })) ?? approved;
    }
    async reject(actor, id, reason) {
        if (!isSuper(actor))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
        const row = await this.must(id);
        if (row.createdBy === actor.sub)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_SELF_APPROVAL', 'Reject is a checker action: use a different super admin (the author can leave the draft)');
        return this.move(actor.sub, 'reject', row, { status: 'REJECTED', reason: `${row.reason ?? ''}${row.reason ? ' | ' : ''}rejected: ${reason}`.slice(0, 500) }, ['PENDING_APPROVAL']);
    }
    async rollback(actor, i, now = new Date()) {
        if (!isSuper(actor))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
        this.assertKind(i.kind);
        this.assertScope(i);
        const target = await this.prisma.growthConfigVersion.findUnique({ where: { kind_scope_scopeId_version: { kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', version: i.toVersion } } });
        if (!target)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_NOT_FOUND', `Version ${i.toVersion} of ${i.kind} does not exist`);
        if (!['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'].includes(target.status))
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only a version that has been active can be restored', { status: target.status });
        await this.assertNoOtherPending({ id: '', kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '' });
        const row = await this.createRow({ kind: i.kind, scope: i.scope, scopeId: i.scopeId ?? '', payload: target.payload, createdBy: actor.sub, effectiveFrom: i.effectiveFrom ?? null, ticket: i.ticket, reason: `rollback to v${i.toVersion}: ${i.reason}`.slice(0, 500), announcement: i.announcement, status: 'DRAFT', supersedesId: target.id });
        await this.audit(actor.sub, 'rollback', row, { after: row.checksum, restoredVersion: i.toVersion });
        this.assertMoneyPolicy(row, now);
        return this.move(actor.sub, 'submit', row, { status: 'PENDING_APPROVAL' }, ['DRAFT']);
    }
    async activateDue(now = new Date()) {
        const due = await this.prisma.growthConfigVersion.findMany({ where: { status: 'APPROVED', effectiveFrom: { lte: now } }, orderBy: [{ effectiveFrom: 'asc' }, { version: 'asc' }] });
        let n = 0;
        for (const row of due) {
            try {
                await this.prisma.$transaction(async (tx) => {
                    const cur = await tx.growthConfigVersion.findFirst({ where: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, status: 'ACTIVE' } });
                    const from = row.effectiveFrom;
                    if (cur)
                        await tx.growthConfigVersion.update({ where: { id: cur.id }, data: { status: row.supersedesId ? 'ROLLED_BACK' : 'SUPERSEDED', effectiveTo: new Date(Math.max(from.getTime(), (cur.effectiveFrom?.getTime() ?? 0) + 1)) } });
                    const claimed = await tx.growthConfigVersion.updateMany({ where: { id: row.id, status: 'APPROVED' }, data: { status: 'ACTIVE' } });
                    if (!claimed.count)
                        throw new Error('already activated');
                    await tx.auditLog.create({ data: { actor: 'system:growth', action: 'growth.config.activate', resource: 'GrowthConfigVersion', resourceId: row.id, metadata: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: row.version, checksum: row.checksum, supersededVersion: cur?.version ?? null } } });
                });
                n++;
            }
            catch (e) {
                if (e.code !== 'P2002' && e.message !== 'already activated')
                    throw e;
            }
        }
        if (n > 0)
            this.invalidate();
        return n;
    }
    async activate(actor, id, now = new Date()) {
        if (!isSuper(actor))
            throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: ['super_admin'] });
        const row = await this.must(id);
        if (row.status === 'ACTIVE')
            return row;
        if (row.status !== 'APPROVED')
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Only an approved version can be activated', { status: row.status });
        if (row.effectiveFrom && row.effectiveFrom.getTime() > now.getTime())
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_EFFECTIVE_TOO_SOON', 'This version is approved and scheduled: it activates at its effective date', { effectiveFrom: row.effectiveFrom.toISOString() });
        await this.activateDue(now);
        return this.must(id);
    }
    async diff(id, againstId) {
        const row = await this.must(id);
        let base = againstId ? await this.must(againstId) : null;
        if (!base && row.supersedesId)
            base = await this.prisma.growthConfigVersion.findUnique({ where: { id: row.supersedesId } });
        if (!base)
            base = await this.prisma.growthConfigVersion.findFirst({ where: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: { lt: row.version }, status: { in: ['ACTIVE', 'SUPERSEDED', 'ROLLED_BACK'] } }, orderBy: { version: 'desc' } });
        const against = base ? { id: base.id, version: base.version, status: base.status } : null;
        const before = base ? base.payload : (growth_defaults_1.GROWTH_DEFAULT_PAYLOADS[row.kind] ?? {});
        return { id: row.id, version: row.version, against, againstIsDefault: !base, changes: (0, config_diff_1.diffPayload)(before, row.payload) };
    }
    async propagation(kind, scope, scopeId, now = new Date()) {
        this.assertKind(kind);
        this.assertScope({ scope, scopeId });
        const inForce = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope, scopeId, status: 'ACTIVE' } });
        const pending = await this.prisma.growthConfigVersion.findMany({ where: { kind, scope, scopeId, status: 'APPROVED' }, orderBy: { effectiveFrom: 'asc' }, select: { id: true, version: true, effectiveFrom: true } });
        const status = await this.readers.status(kind, scope, scopeId, inForce ? { versionId: inForce.id, version: inForce.version } : null, now);
        return { kind, scope, scopeId, cacheTtlMs: this.cacheTtlMs(), ...status, scheduled: pending.map((p) => ({ id: p.id, version: p.version, effectiveFrom: p.effectiveFrom?.toISOString() ?? null })) };
    }
    async list(o = {}) {
        if (o.status && !contracts_1.GROWTH_CONFIG_STATES.includes(o.status))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown status');
        return this.prisma.growthConfigVersion.findMany({ where: { ...(o.kind ? { kind: o.kind } : {}), ...(o.status ? { status: o.status } : {}), ...(o.scope ? { scope: o.scope } : {}), ...(o.scopeId !== undefined ? { scopeId: o.scopeId } : {}) }, orderBy: [{ kind: 'asc' }, { scope: 'asc' }, { scopeId: 'asc' }, { version: 'desc' }], take: 200 });
    }
    get(id) { return this.must(id); }
    auditTrail(id) { return this.prisma.auditLog.findMany({ where: { resource: 'GrowthConfigVersion', resourceId: id }, orderBy: { createdAt: 'asc' }, select: { id: true, actor: true, action: true, metadata: true, createdAt: true } }); }
    async inForcePayload(kind, scope, scopeId, excludeId) {
        const own = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope, scopeId, status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) } });
        if (own)
            return own.payload;
        if (scope === 'MARKET') {
            const g = await this.prisma.growthConfigVersion.findFirst({ where: { kind, scope: 'GLOBAL', scopeId: '', status: 'ACTIVE', ...(excludeId ? { id: { not: excludeId } } : {}) } });
            if (g)
                return g.payload;
        }
        return (growth_defaults_1.GROWTH_DEFAULT_PAYLOADS[kind] ?? null);
    }
    async guard(i, countBudget) {
        const secrets = (0, config_guardrails_1.findSecretViolations)(i.payload);
        if (secrets.length)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'Configuration may reference secrets by name only', { errors: secrets });
        const g = (0, config_guardrails_1.evaluateGuardrails)({ ...i, current: await this.inForcePayload(i.kind, i.scope, i.scopeId) });
        if (g.errors.length)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'Change refused by a guardrail', { errors: g.errors, warnings: g.warnings });
        if (countBudget) {
            const dayStart = new Date();
            dayStart.setUTCHours(0, 0, 0, 0);
            const made = await this.prisma.growthConfigVersion.count({ where: { kind: i.kind, scope: i.scope, scopeId: i.scopeId, createdAt: { gte: dayStart }, NOT: { ticket: growth_defaults_1.PROPOSED_DEFAULT_MARKER } } });
            if (made >= (0, config_guardrails_1.DAILY_VERSION_BUDGET)())
                throw (0, growth_errors_1.growthError)('GROWTH_RATE_LIMITED', 'Daily version budget for this configuration is used up', { budget: (0, config_guardrails_1.DAILY_VERSION_BUDGET)() });
        }
    }
    async assertNoOtherPending(row) {
        const other = await this.prisma.growthConfigVersion.findFirst({ where: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, status: 'PENDING_APPROVAL', id: { not: row.id } }, select: { version: true } });
        if (other)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'Another version of this configuration is already waiting for approval; approve or reject it first', { pendingVersion: other.version });
    }
    assertKind(kind) { if (!contracts_1.GROWTH_CONFIG_KINDS.includes(kind) && !exports.LOCAL_CONFIG_KINDS.includes(kind))
        throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', `Unknown config kind ${kind}`); }
    assertScope(s) {
        if (s.scope === 'GLOBAL' && (s.scopeId ?? '') !== '')
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'GLOBAL scope has no scopeId');
        if (s.scope === 'MARKET' && !/^[A-Z]{2}$/.test(s.scopeId))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'MARKET scope needs an ISO country code as scopeId');
    }
    assertMoneyPolicy(row, now) {
        if (exports.ANNOUNCEMENT_KINDS.includes(row.kind) && (!row.announcement || row.announcement.trim().length < 10))
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'An announcement text is required for this kind', { errors: ['/announcement required'] });
        if (!exports.MONEY_POLICY_KINDS.includes(row.kind))
            return;
        if (!row.announcement || row.announcement.trim().length < 10)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_INVALID', 'An announcement text for providers is required for this kind', { errors: ['/announcement required'] });
        if (!row.effectiveFrom || row.effectiveFrom.getTime() < now.getTime() + exports.MONEY_POLICY_LEAD_MS)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_EFFECTIVE_TOO_SOON', 'effectiveFrom must be at least 7 days after approval for this kind', { minEffectiveFrom: new Date(now.getTime() + exports.MONEY_POLICY_LEAD_MS).toISOString() });
    }
    async must(id) {
        const row = await this.prisma.growthConfigVersion.findUnique({ where: { id } });
        if (!row)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_NOT_FOUND', 'Config version not found');
        return row;
    }
    async createRow(d) {
        for (let attempt = 0; attempt < 5; attempt++) {
            const version = ((await this.prisma.growthConfigVersion.aggregate({ where: { kind: d.kind, scope: d.scope, scopeId: d.scopeId }, _max: { version: true } }))._max.version ?? 0) + 1;
            try {
                return await this.prisma.growthConfigVersion.create({ data: { kind: d.kind, scope: d.scope, scopeId: d.scopeId, version, status: d.status, payload: d.payload, effectiveFrom: d.effectiveFrom, createdBy: d.createdBy, ticket: d.ticket, reason: d.reason, announcement: d.announcement, supersedesId: d.supersedesId, checksum: checksumOf(d.payload) } });
            }
            catch (e) {
                if (e.code !== 'P2002' || attempt === 4)
                    throw e;
            }
        }
        throw new Error('unreachable');
    }
    async move(actor, transition, row, data, from) {
        const r = await this.prisma.growthConfigVersion.updateMany({ where: { id: row.id, status: { in: from } }, data: data });
        if (!r.count)
            throw (0, growth_errors_1.growthError)('GROWTH_CONFIG_TRANSITION_FORBIDDEN', 'The version changed state meanwhile', { status: (await this.must(row.id)).status });
        const next = await this.must(row.id);
        this.invalidate();
        await this.audit(actor, transition, next, { before: row.checksum, after: next.checksum, from: row.status, to: next.status });
        return next;
    }
    audit(actor, transition, row, extra) {
        return this.prisma.auditLog.create({ data: { actor, action: `growth.config.${transition}`, resource: 'GrowthConfigVersion', resourceId: row.id, metadata: { kind: row.kind, scope: row.scope, scopeId: row.scopeId, version: row.version, ticket: row.ticket, ...extra } } });
    }
};
exports.GrowthConfigService = GrowthConfigService;
exports.GrowthConfigService = GrowthConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], GrowthConfigService);
//# sourceMappingURL=growth-config.service.js.map