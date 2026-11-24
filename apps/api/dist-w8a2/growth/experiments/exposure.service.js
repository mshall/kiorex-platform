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
exports.ExposureService = exports.subUnit = exports.visitorUnit = exports.sha256hex = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const assignment_1 = require("./assignment");
const eligibility_1 = require("./eligibility");
const surfaces_1 = require("./surfaces");
const sha256hex = (s) => (0, node_crypto_1.createHash)('sha256').update(s, 'utf8').digest('hex');
exports.sha256hex = sha256hex;
const visitorUnit = (visitorKey) => ({ kind: 'VISITOR', key: `v:${visitorKey}` });
exports.visitorUnit = visitorUnit;
const subUnit = (sub) => ({ kind: 'SUB', key: `s:${sub}`, sub });
exports.subUnit = subUnit;
let ExposureService = class ExposureService {
    prisma;
    flags;
    constructor(prisma, flags) {
        this.prisma = prisma;
        this.flags = flags;
    }
    enabled(market) { return this.flags.isEnabled(growth_flags_1.GROWTH_FLAG.EXPERIMENTS, { market }).catch(() => false); }
    async assignments(unit, ctx, surface) {
        if (!unit || !(await this.enabled(ctx.market)))
            return [];
        const rows = await this.prisma.growthExperiment.findMany({ where: { market: ctx.market, status: 'RUNNING', ...(surface ? { surface } : {}) }, orderBy: { startedAt: 'asc' }, take: 20 });
        const out = [];
        for (const e of rows) {
            const def = (0, surfaces_1.surfaceByKey)(e.surface);
            if (!def || !def.units.includes(unit.kind))
                continue;
            if (!(0, eligibility_1.isEligible)(e.eligibility, ctx))
                continue;
            const a = (0, assignment_1.assign)({ variants: e.variants, allocationBp: e.allocationBp, salt: e.salt, status: e.status }, unit.key);
            if (a.enrolled)
                out.push({ experiment: e.key, surface: e.surface, variant: a.variant, flagKey: e.flagKey });
        }
        return out;
    }
    async expose(unit, ctx, experimentKey, now = new Date()) {
        if (!unit || !(await this.enabled(ctx.market)))
            return { recorded: false, variant: null };
        const e = await this.prisma.growthExperiment.findUnique({ where: { market_key: { market: ctx.market, key: experimentKey } } });
        if (!e || e.status !== 'RUNNING')
            return { recorded: false, variant: null };
        const def = (0, surfaces_1.surfaceByKey)(e.surface);
        if (!def || !def.units.includes(unit.kind) || !(0, eligibility_1.isEligible)(e.eligibility, ctx))
            return { recorded: false, variant: null };
        const a = (0, assignment_1.assign)({ variants: e.variants, allocationBp: e.allocationBp, salt: e.salt, status: e.status }, unit.key);
        if (!a.enrolled || !a.unitHash)
            return { recorded: false, variant: a.variant };
        const res = await this.prisma.growthExperimentExposure.createMany({
            data: [{ experimentId: e.id, market: e.market, day: new Date(now.toISOString().slice(0, 10)), variant: a.variant, unitKind: unit.kind, unitHash: a.unitHash, subRef: unit.kind === 'SUB' && unit.sub ? (0, exports.sha256hex)(unit.sub) : null, firstAt: now }],
            skipDuplicates: true,
        });
        return { recorded: res.count === 1, variant: a.variant };
    }
    unitHashFor(salt, unitKey) { return (0, assignment_1.unitHashOf)(salt, unitKey); }
};
exports.ExposureService = ExposureService;
exports.ExposureService = ExposureService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService])
], ExposureService);
//# sourceMappingURL=exposure.service.js.map