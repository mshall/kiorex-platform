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
exports.GrowthEventsController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const errors_1 = require("../../common/errors");
const auth_1 = require("../../common/auth");
const privacy_hash_1 = require("../../common/privacy-hash");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const growth_flags_1 = require("../growth-flags");
const touch_sanitizer_1 = require("../touch/touch-sanitizer");
const growth_phi_guard_1 = require("./growth-phi-guard");
const growth_events_service_1 = require("./growth-events.service");
const EVENTS_BODY = { schema: { type: 'object', required: ['events'], properties: { events: { type: 'array', maxItems: 20, items: { type: 'object', required: ['name'], properties: { name: { type: 'string' }, occurredAt: { type: 'string' }, careType: { type: 'string' }, landingKind: { type: 'string' }, props: { type: 'object' } } } } } } };
let GrowthEventsController = class GrowthEventsController {
    events;
    constructor(events) {
        this.events = events;
    }
    async record(req, body, consent) {
        if ((req.rawBody?.length ?? 0) > 16_384)
            throw new errors_1.ApiError(413, 'PAYLOAD_TOO_LARGE', 'Request body is too large');
        const events = (0, growth_phi_guard_1.parseEventsBody)(body);
        const key = (0, touch_sanitizer_1.parseCookies)(Array.isArray(req.headers.cookie) ? req.headers.cookie[0] : req.headers.cookie).kxv;
        return this.events.ingest(events, { ipHash: (0, privacy_hash_1.ipHashOf)(req.ip), visitorKey: key && touch_sanitizer_1.VISITOR_KEY_PATTERN.test(key) ? key : null, consentAnalytics: consent?.trim().toLowerCase() === 'analytics' });
    }
};
exports.GrowthEventsController = GrowthEventsController;
__decorate([
    (0, auth_1.Public)(),
    (0, control_plane_public_1.RequiresFlag)(growth_flags_1.GROWTH_FLAG.ATTRIBUTION),
    (0, common_1.Post)('events'),
    (0, common_1.HttpCode)(202),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P1-B record canonical funnel events (batch of up to 20; idempotent; client-reportable names only; no PHI)' }),
    (0, swagger_1.ApiBody)(EVENTS_BODY),
    (0, swagger_1.ApiAcceptedResponse)({ schema: { type: 'object', properties: { accepted: { type: 'integer' }, duplicates: { type: 'integer' } } } }),
    __param(0, (0, common_1.Req)()),
    __param(1, (0, common_1.Body)()),
    __param(2, (0, common_1.Headers)('x-kx-consent')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, Object, String]),
    __metadata("design:returntype", Promise)
], GrowthEventsController.prototype, "record", null);
exports.GrowthEventsController = GrowthEventsController = __decorate([
    (0, swagger_1.ApiTags)('growth'),
    (0, common_1.Controller)('growth/v1'),
    __metadata("design:paramtypes", [growth_events_service_1.GrowthEventsService])
], GrowthEventsController);
//# sourceMappingURL=growth-events.controller.js.map