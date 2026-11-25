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
exports.AnalyticsService = exports.ALLOWED_PROPS = exports.CLIENT_EVENTS = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../common/errors");
const config_1 = require("../common/config");
const safety_public_1 = require("../safety/safety-public");
const prisma_service_1 = require("../prisma/prisma.service");
exports.CLIENT_EVENTS = ['search_started', 'results_viewed', 'slot_viewed', 'booking_started', 'booking_failed', 'review_submitted', 'waitlist_joined', 'vault_opened', 'whatsapp_link_clicked', 'home_search_started', 'home_out_of_coverage', 'safety_card_viewed', 'family_share_started'];
exports.ALLOWED_PROPS = ['specialtyCode', 'providerId', 'market', 'code', 'district', 'careType', 'serviceLocation'];
const ID = /^[A-Za-z0-9_-]{1,64}$/;
const CODE = /^[A-Za-z0-9_]{1,40}$/;
const MARKET = /^[A-Z]{2}$/;
const DISTRICT = /^[a-z0-9][a-z0-9-]{1,39}$/;
let AnalyticsService = class AnalyticsService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    validate(e) {
        if (!exports.CLIENT_EVENTS.includes(e.name))
            throw (0, errors_1.badRequest)('EVENT_NOT_ALLOWED', `event "${String(e.name).slice(0, 40)}" is not in the client analytics whitelist`, { allowed: exports.CLIENT_EVENTS });
        const props = e.props ?? {};
        const out = {};
        for (const [k, v] of Object.entries(props)) {
            if (!exports.ALLOWED_PROPS.includes(k))
                throw (0, errors_1.badRequest)('PROPERTY_NOT_ALLOWED', `property "${k.slice(0, 40)}" is not allowed (PHI-free whitelist)`, { allowed: exports.ALLOWED_PROPS });
            if (typeof v !== 'string')
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', `property ${k} must be a short string`);
            if (k === 'specialtyCode' && !safety_public_1.SPECIALTY_CODES.includes(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'specialtyCode must be a launch specialty code');
            if (k === 'providerId' && !ID.test(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'providerId format invalid');
            if (k === 'market' && !MARKET.test(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'market must be ISO-3166 alpha-2');
            if (k === 'code' && !CODE.test(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'code must be [A-Za-z0-9_]{1,40}');
            if (k === 'district' && !DISTRICT.test(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'district must be a district code (never an address)');
            if (k === 'careType' && !['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'].includes(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'careType must be DOCTORS|PHYSIOTHERAPY|HOME_NURSING');
            if (k === 'serviceLocation' && !['IN_CLINIC', 'HOME'].includes(v))
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'serviceLocation must be IN_CLINIC|HOME');
            if ((0, safety_public_1.detectPhi)(v).length)
                throw (0, errors_1.badRequest)('PROPERTY_INVALID', 'value looks like personal data and was rejected');
            out[k] = v;
        }
        return { name: e.name, ...out };
    }
    async ingest(events) {
        if (!events.length)
            throw (0, errors_1.badRequest)('EMPTY_BATCH', 'events must not be empty');
        if (events.length > (0, config_1.cfg)().analyticsMaxBatch)
            throw (0, errors_1.badRequest)('BATCH_TOO_LARGE', `max ${(0, config_1.cfg)().analyticsMaxBatch} events per request`);
        const valid = events.map((e) => this.validate(e));
        await this.prisma.analyticsEvent.createMany({ data: valid.map((v) => ({ name: v.name, specialtyCode: v.specialtyCode, providerId: v.providerId, market: v.market ?? 'EG', code: v.code, district: v.district, careType: v.careType, serviceLocation: v.serviceLocation })) });
        return { accepted: valid.length };
    }
};
exports.AnalyticsService = AnalyticsService;
exports.AnalyticsService = AnalyticsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], AnalyticsService);
//# sourceMappingURL=analytics.service.js.map