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
exports.EvidenceController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const contracts_1 = require("@kiorex/contracts");
const node_crypto_1 = require("node:crypto");
const auth_1 = require("../../common/auth");
const config_1 = require("../../common/config");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const auth_public_1 = require("../../auth/auth-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_limiter_1 = require("../growth-limiter");
const evidence_service_1 = require("./evidence.service");
const OBJ = { schema: { type: 'object', additionalProperties: true } };
const one = (v) => (Array.isArray(v) ? v[0] : v);
let EvidenceController = class EvidenceController {
    svc;
    verifier;
    prisma;
    limiter;
    constructor(svc, verifier, prisma, limiter) {
        this.svc = svc;
        this.verifier = verifier;
        this.prisma = prisma;
        this.limiter = limiter;
    }
    async evidence(bookingId, req, auth) {
        await this.limiter.take('evidence', (0, privacy_hash_1.ipHashOf)(req.ip), (0, growth_limiter_1.growthLimits)().evidencePerMin);
        if (auth?.toLowerCase().startsWith('bearer ')) {
            let roles = [];
            try {
                const p = await this.verifier.verifyAccess(auth.slice(7).trim());
                roles = Array.isArray(p.kx_roles) ? p.kx_roles : [];
            }
            catch {
                throw new errors_1.ApiError(401, 'INVALID_TOKEN', 'Invalid or expired token');
            }
            if (!roles.some((r) => auth_1.OPS_ROLES.includes(r)))
                throw (0, errors_1.forbidden)('FORBIDDEN_ROLE', 'Insufficient role', { required: auth_1.OPS_ROLES });
            return this.svc.forBooking(bookingId);
        }
        if (!req.headers['x-kiorly-signature'])
            throw new errors_1.ApiError(401, 'UNAUTHENTICATED', 'An ops session or a signed partner request is required');
        const c = (0, config_1.cfg)();
        const v = one(req.headers['x-kiorly-client-key']) === c.kiorlyClientKey ? (0, contracts_1.verifyKiorlyRequest)({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0], body: req.rawBody ?? Buffer.alloc(0), secret: c.kiorlyWebhookSecret }) : { ok: false };
        if (!v.ok)
            throw new errors_1.ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
        const nonce = (0, node_crypto_1.createHash)('sha256').update(`evidence|${one(req.headers['x-kiorly-nonce'])}`).digest('hex');
        try {
            await this.prisma.partnerIntakeNonce.create({ data: { id: nonce } });
        }
        catch {
            throw new errors_1.ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
        }
        const org = one(req.headers['x-kiorly-org-ref'])?.trim();
        if (!org || org.length > 64)
            throw new errors_1.ApiError(401, 'PARTNER_UNAUTHORIZED', 'X-Kiorly-Org-Ref is required');
        return this.svc.forBooking(bookingId, { orgId: org });
    }
};
exports.EvidenceController = EvidenceController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('evidence/:bookingId'),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-B attribution evidence for one booking (ops session or signed partner); facts, never identifiers' }),
    (0, swagger_1.ApiOkResponse)(OBJ),
    __param(0, (0, common_1.Param)('bookingId')),
    __param(1, (0, common_1.Req)()),
    __param(2, (0, common_1.Headers)('authorization')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, Object, String]),
    __metadata("design:returntype", Promise)
], EvidenceController.prototype, "evidence", null);
exports.EvidenceController = EvidenceController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, common_1.Controller)('growth/v1'),
    __param(1, (0, common_1.Inject)(auth_public_1.TOKEN_VERIFIER)),
    __metadata("design:paramtypes", [evidence_service_1.EvidenceService, Object, prisma_service_1.PrismaService, growth_limiter_1.GrowthLimiter])
], EvidenceController);
//# sourceMappingURL=evidence.controller.js.map