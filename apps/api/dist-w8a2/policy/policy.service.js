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
exports.PolicyService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const prisma_service_1 = require("../prisma/prisma.service");
const policy_defaults_1 = require("./policy.defaults");
let PolicyService = class PolicyService {
    prisma;
    log = new common_1.Logger('policy');
    rows = [];
    loadedAt = 0;
    timer;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async onModuleInit() {
        await this.refresh().catch((e) => this.log.warn(`initial policy load failed: ${e.message}`));
        this.timer = setInterval(() => void this.refresh().catch(() => undefined), Math.max(5, (0, config_1.cfg)().policyCacheSeconds) * 1000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async refresh() {
        this.rows = (await this.prisma.policySetting.findMany());
        this.loadedAt = Date.now();
    }
    async ensureFresh(maxAgeMs = 2000) { if (Date.now() - this.loadedAt > maxAgeMs)
        await this.refresh(); }
    get(key, scope = {}) {
        const def = policy_defaults_1.POLICY_DEFS[key];
        const market = scope.market?.toUpperCase();
        const order = [['ORG', 'ORG', scope.orgId], ['MARKET', 'MARKET', market], ['GLOBAL', 'GLOBAL', '']];
        for (const [source, s, id] of order) {
            if (id === undefined)
                continue;
            const row = this.rows.find((r) => r.key === key && r.scope === s && r.scopeId === id);
            if (!row)
                continue;
            try {
                return { key, value: def.validate(row.value), source, proposedDefault: false, note: row.note ?? undefined };
            }
            catch (e) {
                this.log.warn(`ignoring invalid ${key} override at ${s}:${id}: ${e.message}`);
            }
        }
        return { key, value: def.defaults, source: 'PROPOSED_DEFAULT', proposedDefault: true, note: policy_defaults_1.PROPOSED_DEFAULT_NOTE };
    }
    async describe(market) {
        await this.refresh();
        const cc = market.toUpperCase();
        return {
            market: cc, proposedDefaultNote: policy_defaults_1.PROPOSED_DEFAULT_NOTE,
            items: policy_defaults_1.POLICY_KEYS.map((key) => {
                const def = policy_defaults_1.POLICY_DEFS[key];
                const r = this.get(key, { market: cc });
                return {
                    key, titleEn: def.titleEn, titleAr: def.titleAr, descriptionEn: def.descriptionEn, descriptionAr: def.descriptionAr,
                    value: r.value, source: r.source, proposedDefault: r.proposedDefault, note: r.proposedDefault ? policy_defaults_1.PROPOSED_DEFAULT_NOTE : (r.note ?? null),
                    defaults: def.defaults, scopes: def.scopes,
                    overrides: this.rows.filter((x) => x.key === key && (x.scope !== 'MARKET' || x.scopeId === cc)).map((x) => ({ scope: x.scope, scopeId: x.scopeId, value: x.value, note: x.note, updatedBy: x.updatedBy, updatedAt: x.updatedAt.toISOString() })),
                };
            }),
        };
    }
    def(key) { const d = policy_defaults_1.POLICY_DEFS[key]; if (!d)
        throw (0, errors_1.notFound)('POLICY_UNKNOWN', 'Unknown policy key'); return d; }
    ref(scope, scopeId) {
        if (scope === 'GLOBAL')
            return '';
        const id = (scope === 'MARKET' ? scopeId?.toUpperCase() : scopeId)?.trim();
        if (!id)
            throw (0, errors_1.badRequest)('SCOPE_ID_REQUIRED', `${scope} scope needs scopeId`);
        if (scope === 'MARKET' && !/^[A-Z]{2}$/.test(id))
            throw (0, errors_1.badRequest)('INVALID_MARKET', 'market must be an ISO 3166-1 alpha-2 code');
        return id;
    }
    async set(key, o, actor) {
        const def = this.def(key);
        if (!def.scopes.includes(o.scope))
            throw (0, errors_1.badRequest)('INVALID_SCOPE', `${key} cannot be overridden at ${o.scope}`);
        let value;
        try {
            value = def.validate(o.value);
        }
        catch (e) {
            throw (0, errors_1.badRequest)('INVALID_POLICY_VALUE', e.message);
        }
        const scopeId = this.ref(o.scope, o.scopeId);
        const before = this.rows.find((r) => r.key === key && r.scope === o.scope && r.scopeId === scopeId)?.value ?? null;
        await this.prisma.policySetting.upsert({ where: { key_scope_scopeId: { key, scope: o.scope, scopeId } }, create: { key, scope: o.scope, scopeId, value: value, note: o.note, updatedBy: actor }, update: { value: value, note: o.note, updatedBy: actor } });
        await this.prisma.auditLog.create({ data: { actor, action: 'policy.set', resource: 'PolicySetting', resourceId: `${key}:${o.scope}:${scopeId}`, metadata: { before, after: value, note: o.note ?? null } } });
        await this.refresh();
        return { key, scope: o.scope, scopeId, value };
    }
    async clear(key, o, actor) {
        this.def(key);
        const scopeId = this.ref(o.scope, o.scopeId);
        const r = await this.prisma.policySetting.deleteMany({ where: { key, scope: o.scope, scopeId } });
        if (r.count)
            await this.prisma.auditLog.create({ data: { actor, action: 'policy.clear', resource: 'PolicySetting', resourceId: `${key}:${o.scope}:${scopeId}`, metadata: {} } });
        await this.refresh();
        return { cleared: r.count };
    }
};
exports.PolicyService = PolicyService;
exports.PolicyService = PolicyService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], PolicyService);
//# sourceMappingURL=policy.service.js.map