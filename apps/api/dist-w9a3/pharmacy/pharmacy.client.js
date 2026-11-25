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
exports.PharmacyClient = void 0;
const common_1 = require("@nestjs/common");
const partner_http_1 = require("../common/partner-http");
const partners_public_1 = require("../partners/partners-public");
let PharmacyClient = class PharmacyClient {
    registry;
    constructor(registry) {
        this.registry = registry;
    }
    conn(registrationId) { return this.registry.conn('PHARMACY', registrationId); }
    async pharmacies(registrationId) { return (0, partner_http_1.partnerRequest)(await this.conn(registrationId), { method: 'GET', path: '/pharmacies' }); }
    async catalogue(q, registrationId) { return (0, partner_http_1.partnerRequest)(await this.conn(registrationId), { method: 'GET', path: '/catalogue', query: q }); }
    async quote(body, registrationId) { return (0, partner_http_1.partnerRequest)(await this.conn(registrationId), { method: 'POST', path: '/catalogue/quote', body }); }
    async createOrder(key, body, registrationId) { return (0, partner_http_1.partnerRequest)(await this.conn(registrationId), { method: 'POST', path: '/orders', body, idempotencyKey: key }); }
    async validatePrescription(body, registrationId) { return (0, partner_http_1.partnerRequest)(await this.conn(registrationId), { method: 'POST', path: '/prescriptions/validate', body }); }
    async cancelOrder(orderId, reason, registrationId) { return (0, partner_http_1.partnerRequest)(await this.conn(registrationId), { method: 'POST', path: `/orders/${encodeURIComponent(orderId)}/cancel`, body: { reason } }); }
};
exports.PharmacyClient = PharmacyClient;
exports.PharmacyClient = PharmacyClient = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [partners_public_1.PartnerRegistry])
], PharmacyClient);
//# sourceMappingURL=pharmacy.client.js.map