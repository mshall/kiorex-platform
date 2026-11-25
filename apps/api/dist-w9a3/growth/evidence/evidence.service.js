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
exports.EvidenceService = void 0;
const common_1 = require("@nestjs/common");
const prisma_service_1 = require("../../prisma/prisma.service");
const attribution_service_1 = require("../attribution/attribution.service");
const growth_errors_1 = require("../growth-errors");
let EvidenceService = class EvidenceService {
    prisma;
    attribution;
    constructor(prisma, attribution) {
        this.prisma = prisma;
        this.attribution = attribution;
    }
    async forBooking(bookingId, scope = {}) {
        const booking = await this.prisma.bookingIntent.findUnique({ where: { id: bookingId }, select: { id: true, tenantId: true, providerId: true } });
        const decision = booking ? await this.attribution.latest(bookingId) : null;
        const tenantId = booking ? (booking.tenantId ?? (await this.prisma.provider.findUnique({ where: { id: booking.providerId }, select: { tenantId: true } }))?.tenantId ?? null) : null;
        if (!booking || !decision || (scope.orgId !== undefined && tenantId !== scope.orgId))
            throw (0, growth_errors_1.growthError)('GROWTH_EVIDENCE_NOT_FOUND', 'No attribution evidence for this booking');
        const touches = await this.prisma.growthTouchpoint.findMany({ where: { id: { in: decision.evidenceTouchIds } }, orderBy: [{ occurredAt: 'asc' }, { id: 'asc' }] });
        return {
            bookingId,
            decision: { id: decision.id, origin: decision.origin, reason: decision.reasonCode, policyVersion: decision.policyVersionId, inputsHash: decision.inputsHash, supersedesId: decision.supersedesId, createdAt: decision.createdAt.toISOString() },
            touches: touches.map((t) => ({ id: t.id, kind: t.kind, ...(t.linkCode ? { ref: t.linkCode } : {}), occurredAt: t.occurredAt.toISOString(), dwellMs: t.dwellMs, winning: t.id === decision.winningTouchId })),
        };
    }
};
exports.EvidenceService = EvidenceService;
exports.EvidenceService = EvidenceService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, attribution_service_1.AttributionService])
], EvidenceService);
//# sourceMappingURL=evidence.service.js.map