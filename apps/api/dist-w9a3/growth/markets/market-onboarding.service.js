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
exports.MarketOnboardingService = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const market_core_public_1 = require("../../market/market-core-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const safety_public_1 = require("../../safety/safety-public");
const growth_config_service_1 = require("../config/growth-config.service");
const config_bundle_1 = require("./config-bundle");
const data_cells_1 = require("./data-cells");
const geography_csv_1 = require("./geography-csv");
const onboarding_steps_1 = require("./onboarding-steps");
const readiness_1 = require("./readiness");
const CC = /^[A-Z]{2}$/;
const flagKey = (cc) => `market.${cc.toLowerCase()}.live`;
let MarketOnboardingService = class MarketOnboardingService {
    prisma;
    config;
    flags;
    profiles;
    constructor(prisma, config, flags, profiles) {
        this.prisma = prisma;
        this.config = config;
        this.flags = flags;
        this.profiles = profiles;
    }
    async audit(actor, action, cc, metadata = {}) { await this.prisma.auditLog.create({ data: { actor, action: `growth.market_onboarding.${action}`, resource: 'MarketOnboardingPlan', resourceId: cc, metadata: metadata } }); }
    assertCc(cc) { if (!CC.test(cc))
        throw (0, errors_1.badRequest)('GROWTH_INVALID_REQUEST', 'A market code is two capital letters (ISO 3166-1 alpha-2)'); }
    async plan(cc) { this.assertCc(cc); const p = await this.prisma.marketOnboardingPlan.findUnique({ where: { cc } }); if (!p)
        throw (0, errors_1.notFound)('MARKET_PLAN_NOT_FOUND', `No onboarding plan for ${cc}`); return p; }
    present(p) { return { cc: p.cc, status: p.status, steps: p.steps, createdBy: p.createdBy, createdAt: p.createdAt.toISOString(), updatedAt: p.updatedAt.toISOString(), readyAt: p.readyAt?.toISOString() ?? null, publishedAt: p.publishedAt?.toISOString() ?? null }; }
    async list() { return (await this.prisma.marketOnboardingPlan.findMany({ orderBy: { cc: 'asc' } })).map((p) => this.present(p)); }
    async get(cc) { return this.present(await this.plan(cc)); }
    catalogue() { return { steps: [...onboarding_steps_1.STEPS], dataCells: (0, data_cells_1.loadDataCells)(), existing: Object.keys(market_core_public_1.CODE_PROFILES), specialties: safety_public_1.SPECIALTY_CODES.map((code) => ({ code, ...safety_public_1.SPECIALTY_LABELS[code] })) }; }
    async create(actor, cc) {
        this.assertCc(cc);
        if (market_core_public_1.CODE_PROFILES[cc])
            throw (0, errors_1.conflict)('MARKET_EXISTS', `${cc} is already a market of the code fallback; change it through its configuration versions`);
        if (await this.prisma.marketOnboardingPlan.findUnique({ where: { cc } }))
            throw (0, errors_1.conflict)('MARKET_PLAN_EXISTS', `An onboarding plan for ${cc} already exists`);
        const row = await this.prisma.marketOnboardingPlan.create({ data: { cc, createdBy: actor.sub } });
        await this.audit(actor.sub, 'create', cc);
        return this.present(row);
    }
    async setStep(actor, cc, step, payload) {
        const p = await this.plan(cc);
        if (!(0, onboarding_steps_1.isStep)(step))
            throw (0, errors_1.badRequest)('GROWTH_INVALID_REQUEST', `Unknown step ${step}`);
        if (p.status === 'PUBLISHED' || p.status === 'CANCELLED')
            throw (0, errors_1.conflict)('MARKET_PLAN_LOCKED', 'The plan is published: change the market through its configuration versions');
        const errors = (0, onboarding_steps_1.validateStep)(step, payload);
        if (errors.length)
            throw (0, errors_1.unprocessable)('GROWTH_CONFIG_INVALID', 'The answer does not validate', { errors });
        if (step === 'residency') { }
        const steps = { ...p.steps, [step]: payload };
        const row = await this.prisma.marketOnboardingPlan.update({ where: { cc }, data: { steps: steps, status: 'DRAFT', readyAt: null } });
        await this.audit(actor.sub, 'step', cc, { step });
        return this.present(row);
    }
    previewGeography(input) {
        const d = (0, geography_csv_1.decodeCsv)(input);
        if ('error' in d)
            return { ok: false, errors: [d.error], cities: 0, districts: 0, sample: [], totalLines: 0 };
        const r = (0, geography_csv_1.parseGeography)(d.text);
        return { ok: r.errors.length === 0, errors: r.errors, cities: r.cities, districts: r.districts, totalLines: r.totalLines, truncatedErrors: r.truncatedErrors, sample: r.rows.slice(0, 20) };
    }
    async importGeography(actor, cc, input) {
        const p = await this.plan(cc);
        if (p.status === 'PUBLISHED' || p.status === 'CANCELLED')
            throw (0, errors_1.conflict)('MARKET_PLAN_LOCKED', 'The plan is published');
        const d = (0, geography_csv_1.decodeCsv)(input);
        if ('error' in d)
            throw (0, errors_1.unprocessable)('GEOGRAPHY_INVALID', d.error.message, { errors: [d.error] });
        const r = (0, geography_csv_1.parseGeography)(d.text);
        if (r.errors.length)
            throw (0, errors_1.unprocessable)('GEOGRAPHY_INVALID', 'The geography file has errors; nothing was imported', { errors: r.errors, truncatedErrors: r.truncatedErrors });
        await this.prisma.$transaction(async (tx) => {
            await tx.marketGeography.deleteMany({ where: { market: cc } });
            for (let i = 0; i < r.rows.length; i += 2000)
                await tx.marketGeography.createMany({ data: r.rows.slice(i, i + 2000).map((g) => ({ market: cc, ...g })) });
            await tx.growthSlug.deleteMany({ where: { market: cc, entityType: { in: ['CITY', 'DISTRICT'] } } });
            for (let i = 0; i < r.rows.length; i += 2000)
                await tx.growthSlug.createMany({ data: r.rows.slice(i, i + 2000).map((g) => ({ market: cc, entityType: g.level, entityId: g.key, slug: g.slugEn })) });
            const steps = { ...p.steps, geography: { count: r.rows.length, cities: r.cities, districts: r.districts, importedAt: new Date().toISOString() } };
            await tx.marketOnboardingPlan.update({ where: { cc }, data: { steps: steps, status: 'DRAFT', readyAt: null } });
        }, { timeout: 120_000 });
        await this.audit(actor.sub, 'geography', cc, { cities: r.cities, districts: r.districts });
        return { cities: r.cities, districts: r.districts };
    }
    async geography(cc, level) { this.assertCc(cc); return this.prisma.marketGeography.findMany({ where: { market: cc, ...(level === 'CITY' || level === 'DISTRICT' ? { level } : {}) }, orderBy: [{ level: 'asc' }, { key: 'asc' }], take: 5000, select: { level: true, key: true, parentKey: true, nameAr: true, nameEn: true, slugAr: true, slugEn: true, active: true } }); }
    async readiness(cc) {
        const p = await this.plan(cc);
        await this.profiles.refresh().catch(() => undefined);
        const [cities, districts, versions, def, live, sameCell] = await Promise.all([
            this.prisma.marketGeography.count({ where: { market: cc, level: 'CITY' } }), this.prisma.marketGeography.count({ where: { market: cc, level: 'DISTRICT' } }),
            this.prisma.growthConfigVersion.findMany({ where: { scope: 'MARKET', scopeId: cc, kind: { in: ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS'] }, status: { in: ['DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'ACTIVE'] } }, select: { kind: true, status: true }, orderBy: { version: 'asc' } }),
            this.prisma.flagDefinition.findUnique({ where: { key: flagKey(cc) }, select: { key: true } }), this.flags.isEnabled(flagKey(cc), { market: cc }).catch(() => false), this.sameCell(cc, p.steps.residency?.dataCellId),
        ]);
        const rank = { NONE: 0, DRAFT: 1, PENDING_APPROVAL: 2, APPROVED: 3, ACTIVE: 4 };
        const v = {};
        for (const r of versions) {
            const k = r.kind;
            const s = r.status;
            if ((rank[v[k] ?? 'NONE'] ?? 0) < rank[s])
                v[k] = s;
        }
        const out = (0, readiness_1.readiness)({ steps: p.steps, geography: { cities, districts }, versions: v, flagDefined: !!def, live, sameCellMarkets: sameCell });
        return { cc, status: p.status, ...out, dataCell: p.steps.residency?.dataCellId ?? null, sameCellMarkets: sameCell };
    }
    async sameCell(cc, cell) {
        if (!cell)
            return [];
        const others = await this.prisma.marketOnboardingPlan.findMany({ where: { cc: { not: cc } }, select: { cc: true, steps: true } });
        const bound = Object.entries((0, data_cells_1.loadDataCells)().bindings).filter(([, c]) => c === cell).map(([m]) => m);
        return [...new Set([...bound, ...others.filter((o) => (o.steps.residency?.dataCellId) === cell).map((o) => o.cc)])].filter((c) => c !== cc).sort();
    }
    async publish(actor, cc) {
        const p = await this.plan(cc);
        const steps = p.steps;
        const missing = ['identity', 'regulation', 'consent', 'residency'].filter((s) => !steps[s] || (0, onboarding_steps_1.validateStep)(s, steps[s]).length);
        if (missing.length)
            throw (0, errors_1.unprocessable)('MARKET_PLAN_INCOMPLETE', `Answer these steps first: ${missing.join(', ')}`, { missing });
        const b = (0, config_bundle_1.buildBundle)(cc, steps);
        const problems = [];
        for (const [kind, payload] of Object.entries(b)) {
            const v = kind === 'MARKET_PROFILE' ? { valid: (0, market_core_public_1.validateMarketProfile)(payload).length === 0, errors: (0, market_core_public_1.validateMarketProfile)(payload) } : (0, growth_config_service_1.validateGrowthConfig)(kind, payload);
            if (!v.valid)
                problems.push(`${kind}: ${v.errors.join('; ')}`);
        }
        if (problems.length)
            throw (0, errors_1.unprocessable)('GROWTH_CONFIG_INVALID', 'The bundle does not validate', { errors: problems });
        const drafted = {};
        for (const kind of ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS']) {
            const d = await this.config.createDraft(actor, { kind, scope: 'MARKET', scopeId: cc, payload: b[kind], reason: `Market onboarding wizard for ${cc}` });
            const s = await this.config.submit(actor, d.id);
            drafted[kind] = { id: s.id, version: s.version, status: s.status };
        }
        await this.flags.registerDefinition(actor.sub, { key: flagKey(cc), product: 'all', class: 'LAUNCH_LOCKED', scopes: ['GLOBAL'], dependsOn: [], launchLocked: true, description: `Market ${cc} is live (human gate)`, whenOff: 'Country hidden from sign-up and search; existing tenants unaffected', gateHint: 'NEEDS_HUMAN: market pack certification and local counsel; recorded by a person in the super admin' });
        await this.prisma.marketOnboardingPlan.update({ where: { cc }, data: { status: 'PUBLISHED', publishedAt: new Date() } });
        await this.audit(actor.sub, 'publish', cc, { kinds: Object.keys(drafted) });
        return { cc, drafted, flag: flagKey(cc), next: 'A second super admin approves the three versions in Growth configuration; the market gate stays a human decision.' };
    }
    async cancel(actor, cc) { const p = await this.plan(cc); if (p.status === 'PUBLISHED')
        throw (0, errors_1.conflict)('MARKET_PLAN_LOCKED', 'A published plan cannot be cancelled'); await this.prisma.marketOnboardingPlan.update({ where: { cc }, data: { status: 'CANCELLED' } }); await this.audit(actor.sub, 'cancel', cc); return { cc, status: 'CANCELLED' }; }
};
exports.MarketOnboardingService = MarketOnboardingService;
exports.MarketOnboardingService = MarketOnboardingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, growth_config_service_1.GrowthConfigService, control_plane_public_1.FlagsService, market_core_public_1.MarketProfileService])
], MarketOnboardingService);
//# sourceMappingURL=market-onboarding.service.js.map