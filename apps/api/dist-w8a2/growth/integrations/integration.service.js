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
exports.IntegrationService = exports.secretEnvName = exports.isKind = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const ids_1 = require("../../common/ids");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const outbox_public_1 = require("../../outbox/outbox-public");
const platform_public_1 = require("../../platform/platform-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const spend_service_1 = require("../analytics/spend.service");
const growth_config_service_1 = require("../config/growth-config.service");
const growth_errors_1 = require("../growth-errors");
const growth_flags_1 = require("../growth-flags");
const circuit_1 = require("./circuit");
const mock_adapter_1 = require("./mock/mock.adapter");
const port_1 = require("./port");
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const MARKET = /^[A-Z]{2}$/;
const day = (d) => d.toISOString().slice(0, 10);
const isKind = (k) => port_1.GROWTH_INTEGRATION_KINDS.includes(k);
exports.isKind = isKind;
const secretEnvName = (ref) => ref.toUpperCase().replace(/[^A-Z0-9]/g, '_');
exports.secretEnvName = secretEnvName;
let IntegrationService = class IntegrationService {
    prisma;
    config;
    flags;
    outbox;
    spend;
    log = new common_1.Logger('growth-integrations');
    adapterOverride = null;
    sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    constructor(prisma, config, flags, outbox, spend) {
        this.prisma = prisma;
        this.config = config;
        this.flags = flags;
        this.outbox = outbox;
        this.spend = spend;
    }
    async setting(kind, market) {
        const cfg = await this.config.resolve('INTEGRATION', { market });
        const s = (cfg.payload.integrations ?? {})[kind] ?? {};
        return { mode: s.mode === 'real' ? 'real' : 'mock', secretRef: typeof s.secretRef === 'string' && platform_public_1.SECRET_REF.test(s.secretRef) ? s.secretRef : null, accountLabel: String(s.accountLabel ?? ''), pullSchedule: String(s.pullSchedule ?? 'daily'), rateBudgetPerHour: Number(s.rateBudgetPerHour ?? 60), retentionDays: Number(s.retentionDays ?? 395) };
    }
    adapter(kind, s) {
        const o = this.adapterOverride?.(kind, s.mode);
        if (o)
            return o;
        if (s.mode === 'mock')
            return (0, mock_adapter_1.mockFor)(kind);
        return (0, platform_public_1.realAdapterFor)(kind, { secretRef: s.secretRef, account: s.accountLabel, resolveSecret: async (ref) => process.env[(0, exports.secretEnvName)(ref)] || null });
    }
    async breaker(kind, market) {
        const h = await this.prisma.growthIntegrationHealth.findUnique({ where: { kind_market: { kind, market } } });
        return { circuit: h?.circuit ?? 'CLOSED', consecutiveFailures: h?.consecutiveFailures ?? 0, lastErrorAt: h?.lastErrorAt ?? null };
    }
    async campaignKeys(market) {
        const rows = await this.prisma.growthCampaign.findMany({ where: { market, status: { in: ['ACTIVE', 'PAUSED', 'SCHEDULED', 'COMPLETED'] } }, select: { utmCampaign: true }, orderBy: { updatedAt: 'desc' }, take: 100 });
        return [...new Set(rows.map((r) => r.utmCampaign).filter(Boolean))];
    }
    validateRange(from, to, now = new Date()) {
        const t = to ?? day(now);
        const f = from ?? day(new Date(now.getTime() - 2 * 86_400_000));
        if (!ISO.test(f) || !ISO.test(t) || Number.isNaN(Date.parse(f)) || Number.isNaN(Date.parse(t)))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from and to must be YYYY-MM-DD');
        if (f > t)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'from must not be after to');
        if (Date.parse(t) - Date.parse(f) > 92 * 86_400_000)
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'a pull covers at most 93 days');
        if (t > day(new Date(now.getTime() + 86_400_000)))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'the window cannot end in the future');
        return { from: f, to: t };
    }
    async run(kind, o) {
        const market = o.market && MARKET.test(o.market) ? o.market : growth_flags_1.GROWTH_DEFAULT_MARKET;
        const now = o.now ?? new Date();
        const s = await this.setting(kind, market);
        const flag = await this.flags.evaluate(`growth.integrations.${kind}`, { market });
        if (!flag.effective)
            return { runId: null, kind, mode: s.mode, status: 'SKIPPED', rows: 0, reason: 'FLAG_OFF' };
        const range = this.validateRange(o.from, o.to, now);
        const br = await this.breaker(kind, market);
        const gate = (0, circuit_1.allowRun)(br, now);
        if (!gate.allowed)
            return { runId: null, kind, mode: s.mode, status: 'SKIPPED', rows: 0, reason: 'CIRCUIT_OPEN' };
        const used = await this.prisma.growthIntegrationRun.count({ where: { kind, market, startedAt: { gte: new Date(now.getTime() - 3_600_000) } } });
        if (used >= s.rateBudgetPerHour)
            throw new errors_1.ApiError(429, 'INTEGRATION_RATE_BUDGET', 'The hourly request budget of this integration is used up', { kind, budget: s.rateBudgetPerHour });
        const run = await this.prisma.growthIntegrationRun.create({ data: { id: (0, ids_1.newId)('gir'), market, kind, mode: s.mode, windowFrom: new Date(`${range.from}T00:00:00Z`), windowTo: new Date(`${range.to}T00:00:00Z`), status: 'FAILED', startedAt: now } });
        const keys = port_1.PAID_KINDS.includes(kind) ? await this.campaignKeys(market) : [];
        const pr = { ...range, dimensionKeys: keys, currency: 'EGP' };
        const adapter = this.adapter(kind, s);
        let rows = [];
        let failures = 0;
        let lastCode = '';
        let lastWasNeedsHuman = false;
        for (const what of port_1.PULLS[kind]) {
            const fn = what === 'spend' ? adapter.pullSpend : what === 'performance' ? adapter.pullPerformance : adapter.pullCoreVitals;
            if (!fn)
                continue;
            try {
                rows = rows.concat(await this.withRetry(() => fn.call(adapter, pr)));
            }
            catch (e) {
                failures++;
                lastWasNeedsHuman = e instanceof platform_public_1.NeedsHumanError;
                lastCode = e instanceof platform_public_1.NeedsHumanError ? 'NEEDS_HUMAN' : e instanceof platform_public_1.UpstreamError ? e.errorCode : 'UPSTREAM_ERROR';
                this.log.warn(`${kind} ${what} failed: ${lastCode}`);
            }
        }
        const planned = port_1.PULLS[kind].length;
        let saved = 0;
        let spendLines = 0;
        try {
            saved = await this.store(kind, market, range, rows, s);
            if (s.mode === 'real' && port_1.PAID_KINDS.includes(kind))
                spendLines = await this.spendLines(kind, market, rows, keys);
        }
        catch (e) {
            failures = Math.max(failures, 1);
            lastCode = 'STORE_ERROR';
            this.log.warn(`${kind} store failed: ${e.message.slice(0, 80)}`);
        }
        const status = failures === 0 ? 'OK' : failures < planned && rows.length ? 'PARTIAL' : 'FAILED';
        await this.prisma.growthIntegrationRun.update({ where: { id: run.id }, data: { status, rows: saved, error: failures ? lastCode : null, finishedAt: new Date() } });
        const after = (0, circuit_1.afterRun)(br, status !== 'FAILED', now);
        await this.prisma.growthIntegrationHealth.upsert({ where: { kind_market: { kind, market } }, create: { kind, market, circuit: after.circuit, consecutiveFailures: after.consecutiveFailures, lastOkAt: status !== 'FAILED' ? now : null, lastErrorAt: status === 'FAILED' ? now : null }, update: { circuit: after.circuit, consecutiveFailures: after.consecutiveFailures, ...(status !== 'FAILED' ? { lastOkAt: now } : { lastErrorAt: now }) } });
        if (status === 'FAILED')
            await this.outbox.enqueue(this.prisma, { type: 'IntegrationRunFailed', aggregateType: 'GrowthIntegrationRun', aggregateId: run.id, payload: { kind, market, mode: s.mode, errorCode: lastCode || 'UPSTREAM_ERROR', consecutiveFailures: after.consecutiveFailures, at: now.toISOString(), aggregateType: 'GrowthIntegrationRun', aggregateId: run.id }, dedupeKey: `IntegrationRunFailed:${run.id}` });
        await this.prisma.auditLog.create({ data: { actor: o.actor, action: 'growth.integration.run', resource: 'GrowthIntegrationRun', resourceId: run.id, metadata: { kind, market, mode: s.mode, trigger: o.trigger, status, rows: saved, window: range, needsHuman: lastWasNeedsHuman } } });
        return { runId: run.id, kind, mode: s.mode, status, rows: saved, ...(failures ? { reason: lastCode } : {}), spendLines };
    }
    async withRetry(fn, attempts = 3) {
        for (let i = 0;; i++) {
            try {
                return await fn();
            }
            catch (e) {
                const retryable = e instanceof platform_public_1.UpstreamError && e.errorCode !== 'UPSTREAM_PARSE' && !(e.status && e.status >= 400 && e.status < 500 && e.status !== 429);
                if (!retryable || i >= attempts - 1)
                    throw e;
                await this.sleep((0, circuit_1.backoffMs)(i));
            }
        }
    }
    async store(kind, market, r, rows, s) {
        const clean = rows.filter((x) => x.day >= r.from && x.day <= r.to && Number.isFinite(x.value));
        if (!clean.length)
            return 0;
        const dims = [...new Set(clean.map((x) => x.dimensionKey))];
        const metrics = [...new Set(clean.map((x) => x.metric))];
        await this.prisma.$transaction(async (tx) => {
            await tx.growthExternalMetricDaily.deleteMany({ where: { market, kind, day: { gte: new Date(`${r.from}T00:00:00Z`), lte: new Date(`${r.to}T00:00:00Z`) }, dimensionKey: { in: dims }, metric: { in: metrics } } });
            for (let i = 0; i < clean.length; i += 500)
                await tx.growthExternalMetricDaily.createMany({ data: clean.slice(i, i + 500).map((x) => ({ market, kind, day: new Date(`${x.day}T00:00:00Z`), dimensionKey: x.dimensionKey.slice(0, 120), metric: x.metric, value: x.value, currency: x.currency ?? null })), skipDuplicates: true });
        }, { timeout: 30_000 });
        return clean.length;
    }
    async spendLines(kind, market, rows, keys) {
        const camps = await this.prisma.growthCampaign.findMany({ where: { market, utmCampaign: { in: keys } }, select: { id: true, utmCampaign: true } });
        const byKey = new Map(camps.map((c) => [c.utmCampaign, c.id]));
        let n = 0;
        for (const r of rows.filter((x) => x.metric === 'spend_minor' && x.value > 0)) {
            const campaignId = byKey.get(r.dimensionKey);
            if (!campaignId)
                continue;
            try {
                await this.spend.create(`system:integration:${kind}`, { day: r.day, amountMinor: Math.round(r.value), campaignId, source: 'ADAPTER', adapterRef: `${kind}:${r.day}:${r.dimensionKey}`.slice(0, 120), channel: kind, market });
                n++;
            }
            catch (e) {
                this.log.warn(`${kind} spend line skipped: ${e.code ?? 'error'}`);
            }
        }
        return n;
    }
    async purgeExpired(now = new Date()) {
        let n = 0;
        for (const kind of port_1.GROWTH_INTEGRATION_KINDS) {
            const months = port_1.INTEGRATION_META[kind].retentionMonths;
            const cut = new Date(now);
            cut.setUTCMonth(cut.getUTCMonth() - months);
            n += (await this.prisma.growthExternalMetricDaily.deleteMany({ where: { kind, day: { lt: cut } } })).count;
        }
        await this.prisma.growthIntegrationRun.deleteMany({ where: { startedAt: { lt: new Date(now.getTime() - 400 * 86_400_000) } } });
        return n;
    }
    async status(market) {
        const out = [];
        for (const kind of port_1.GROWTH_INTEGRATION_KINDS) {
            const s = await this.setting(kind, market);
            const meta = port_1.INTEGRATION_META[kind];
            const [h, last, flag] = await Promise.all([this.prisma.growthIntegrationHealth.findUnique({ where: { kind_market: { kind, market } } }), this.prisma.growthIntegrationRun.findFirst({ where: { kind, market }, orderBy: { startedAt: 'desc' } }), this.flags.evaluate(`growth.integrations.${kind}`, { market })]);
            const adapter = this.adapter(kind, s);
            const health = await adapter.health().catch(() => ({ ok: false, mode: s.mode, detail: 'unavailable' }));
            out.push({
                kind, label: meta.label, mode: s.mode, flagEffective: flag.effective, flagReason: flag.reason, secretRefSet: !!s.secretRef && !!process.env[(0, exports.secretEnvName)(s.secretRef)], secretRefConfigured: !!s.secretRef, accountLabelSet: !!s.accountLabel,
                pullSchedule: s.pullSchedule, rateBudgetPerHour: s.rateBudgetPerHour, retentionMonths: meta.retentionMonths, location: meta.location, fallback: meta.fallback, defaultOff: meta.defaultOff,
                circuit: h?.circuit ?? 'CLOSED', consecutiveFailures: h?.consecutiveFailures ?? 0, lastOkAt: h?.lastOkAt?.toISOString() ?? null, lastErrorAt: h?.lastErrorAt?.toISOString() ?? null,
                lastRun: last ? { id: last.id, status: last.status, mode: last.mode, rows: last.rows, error: last.error, startedAt: last.startedAt.toISOString() } : null,
                health: { ok: health.ok, detail: health.detail }, connected: !!last && last.status !== 'FAILED' && flag.effective, synthetic: last?.mode === 'mock',
            });
        }
        return { market, integrations: out, rules: { secrets: 'Configuration holds secretRef names only; the API never returns a secret.', data: 'Aggregates only. No person-level field leaves the platform.', conversions: 'Conversion upload is off and not implemented in this phase.' } };
    }
    async runs(market, kind, take = 50) {
        if (kind && !(0, exports.isKind)(kind))
            throw (0, growth_errors_1.growthError)('GROWTH_INVALID_REQUEST', 'Unknown integration kind');
        const rows = await this.prisma.growthIntegrationRun.findMany({ where: { market, ...(kind ? { kind } : {}) }, orderBy: { startedAt: 'desc' }, take: Math.min(200, Math.max(1, take)) });
        return rows.map((r) => ({ id: r.id, kind: r.kind, mode: r.mode, status: r.status, rows: r.rows, error: r.error, windowFrom: r.windowFrom ? day(r.windowFrom) : null, windowTo: r.windowTo ? day(r.windowTo) : null, startedAt: r.startedAt.toISOString(), finishedAt: r.finishedAt?.toISOString() ?? null }));
    }
    async requestRealRun(actor, kind, market, from, to) {
        const s = await this.setting(kind, market);
        if (s.mode !== 'real')
            throw (0, errors_1.badRequest)('INTEGRATION_NOT_REAL', 'Only a real-mode integration needs a confirmation; a mock pull can run directly');
        const range = this.validateRange(from, to);
        const row = await this.prisma.auditLog.create({ data: { actor, action: 'growth.integration.run_request', resource: 'GrowthIntegration', resourceId: kind, metadata: { kind, market, ...range } } });
        return { requestId: row.id, kind, market, ...range };
    }
    async confirmRealRun(actor, kind, requestId) {
        const req = await this.prisma.auditLog.findUnique({ where: { id: requestId } });
        if (!req || req.action !== 'growth.integration.run_request' || req.resourceId !== kind)
            throw (0, errors_1.notFound)('NOT_FOUND', 'Unknown run request');
        if (req.actor === actor)
            throw (0, errors_1.forbidden)('MAKER_CHECKER', 'The person who asked for a real pull cannot confirm it');
        if (Date.now() - req.createdAt.getTime() > 3_600_000)
            throw (0, errors_1.conflict)('REQUEST_EXPIRED', 'The request is older than one hour');
        const used = await this.prisma.auditLog.count({ where: { action: 'growth.integration.run_confirm', resourceId: requestId } });
        if (used)
            throw (0, errors_1.conflict)('REQUEST_USED', 'This request was already confirmed');
        const m = req.metadata;
        await this.prisma.auditLog.create({ data: { actor, action: 'growth.integration.run_confirm', resource: 'GrowthIntegration', resourceId: requestId, metadata: { kind } } });
        return this.run(kind, { market: m.market, from: m.from, to: m.to, trigger: 'MANUAL', actor });
    }
};
exports.IntegrationService = IntegrationService;
exports.IntegrationService = IntegrationService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_config_service_1.GrowthConfigService, control_plane_public_1.FlagsService, outbox_public_1.OutboxService, spend_service_1.GrowthSpendService])
], IntegrationService);
//# sourceMappingURL=integration.service.js.map