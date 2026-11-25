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
exports.CorporateConfigService = exports.CORPORATE_POLICY_DEFAULTS = void 0;
exports.validateCorporatePolicy = validateCorporatePolicy;
exports.mergeCorporatePolicy = mergeCorporatePolicy;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const corporate_privacy_1 = require("./corporate-privacy");
const CORPORATE_POLICY_DEFAULTS = () => ({
    enabled: true,
    eligibility: { openCode: true, domainEmail: true, hrList: true },
    fundingMode: 'SPONSOR_CREDIT',
    minAggregateK: corporate_privacy_1.K_FLOOR,
    codeFormat: { length: 10, groupSize: 5 },
    hrList: { matchWindowDays: 30, maxRows: 5000 },
});
exports.CORPORATE_POLICY_DEFAULTS = CORPORATE_POLICY_DEFAULTS;
const isObj = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const int = (v, lo, hi) => typeof v === 'number' && Number.isInteger(v) && v >= lo && v <= hi;
function validateCorporatePolicy(payload) {
    const errors = [];
    if (!isObj(payload))
        return { errors: ['payload must be an object'] };
    const top = ['enabled', 'eligibility', 'fundingMode', 'minAggregateK', 'codeFormat', 'hrList'];
    for (const k of Object.keys(payload))
        if (!top.includes(k))
            errors.push(`unknown key ${k}`);
    if ('enabled' in payload && typeof payload.enabled !== 'boolean')
        errors.push('enabled must be a boolean');
    if ('fundingMode' in payload && !['SPONSOR_CREDIT', 'PLATFORM_PROMO'].includes(payload.fundingMode))
        errors.push('fundingMode must be SPONSOR_CREDIT or PLATFORM_PROMO');
    if ('minAggregateK' in payload && !int(payload.minAggregateK, corporate_privacy_1.K_FLOOR, 1000))
        errors.push(`minAggregateK must be an integer from ${corporate_privacy_1.K_FLOOR} to 1000`);
    const sub = (key, allowed) => {
        if (!(key in payload))
            return;
        const o = payload[key];
        if (!isObj(o)) {
            errors.push(`${key} must be an object`);
            return;
        }
        for (const [k, v] of Object.entries(o)) {
            if (!(k in allowed))
                errors.push(`unknown key ${key}.${k}`);
            else if (!allowed[k](v))
                errors.push(`${key}.${k} is invalid`);
        }
    };
    const bool = (v) => typeof v === 'boolean';
    sub('eligibility', { openCode: bool, domainEmail: bool, hrList: bool });
    sub('codeFormat', { length: (v) => int(v, 8, 16), groupSize: (v) => int(v, 0, 8) });
    sub('hrList', { matchWindowDays: (v) => int(v, 1, 90), maxRows: (v) => int(v, 1, 100000) });
    return { errors };
}
function mergeCorporatePolicy(base, over) {
    if (!isObj(over) || validateCorporatePolicy(over).errors.length)
        return base;
    const o = over;
    return {
        enabled: o.enabled ?? base.enabled, fundingMode: o.fundingMode ?? base.fundingMode, minAggregateK: Math.max(corporate_privacy_1.K_FLOOR, o.minAggregateK ?? base.minAggregateK),
        eligibility: { ...base.eligibility, ...(o.eligibility ?? {}) }, codeFormat: { ...base.codeFormat, ...(o.codeFormat ?? {}) }, hrList: { ...base.hrList, ...(o.hrList ?? {}) },
    };
}
let CorporateConfigService = class CorporateConfigService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async get(market = growth_flags_1.GROWTH_DEFAULT_MARKET, now = new Date()) {
        let cfg = (0, exports.CORPORATE_POLICY_DEFAULTS)();
        try {
            const rows = await this.prisma.growthConfigVersion.findMany({ where: { kind: 'CORPORATE_POLICY', status: 'ACTIVE', OR: [{ scope: 'GLOBAL', scopeId: '' }, { scope: 'MARKET', scopeId: market }] }, orderBy: { version: 'asc' } });
            const live = rows.filter((r) => (!r.effectiveFrom || r.effectiveFrom <= now) && (!r.effectiveTo || r.effectiveTo > now));
            for (const scope of ['GLOBAL', 'MARKET']) {
                const last = live.filter((r) => r.scope === scope).pop();
                if (last)
                    cfg = mergeCorporatePolicy(cfg, last.payload);
            }
        }
        catch { }
        return cfg;
    }
};
exports.CorporateConfigService = CorporateConfigService;
exports.CorporateConfigService = CorporateConfigService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], CorporateConfigService);
//# sourceMappingURL=corporate-config.js.map