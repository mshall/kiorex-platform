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
exports.CorporateEventsService = exports.CORPORATE_EVENT_TYPES = void 0;
const common_1 = require("@nestjs/common");
const outbox_public_1 = require("../../outbox/outbox-public");
exports.CORPORATE_EVENT_TYPES = ['CorporateAccountCreated', 'CorporateCodeRedeemed'];
let CorporateEventsService = class CorporateEventsService {
    outbox;
    constructor(outbox) {
        this.outbox = outbox;
    }
    onModuleInit() { for (const t of exports.CORPORATE_EVENT_TYPES)
        this.outbox.register(t, async () => undefined); }
    async emit(db, type, aggregateId, data, dedupeKey) {
        await this.outbox.enqueue(db, { type, aggregateType: 'CorporateAccount', aggregateId, payload: { ...data, aggregateType: 'CorporateAccount', aggregateId }, dedupeKey: `${type}:${dedupeKey}` });
    }
};
exports.CorporateEventsService = CorporateEventsService;
exports.CorporateEventsService = CorporateEventsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [outbox_public_1.OutboxService])
], CorporateEventsService);
//# sourceMappingURL=corporate-events.service.js.map