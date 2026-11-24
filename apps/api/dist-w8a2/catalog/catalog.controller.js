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
exports.CatalogController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const market_public_1 = require("../market/market-public");
const catalog_service_1 = require("./catalog.service");
const catalog_dto_1 = require("./catalog.dto");
const provider_mapper_1 = require("./provider-mapper");
const shared_dto_1 = require("../common/shared.dto");
const num = (v) => (v === undefined || v === '' ? undefined : Number(v));
let CatalogController = class CatalogController {
    svc;
    markets;
    flags;
    constructor(svc, markets, flags) {
        this.svc = svc;
        this.markets = markets;
        this.flags = flags;
    }
    search(q, specialty, governorate, area, minFee, maxFee, gender, language, minRating, acceptsDeposit, nextAvailable, sort, lat, lng, maxDistanceKm, page, pageSize, careType, serviceLocation, district, profession) {
        if (sort && !['earliest', 'distance', 'rating', 'fee'].includes(sort))
            throw (0, errors_1.badRequest)('INVALID_SORT', 'sort must be earliest|distance|rating|fee');
        if (nextAvailable && !['today', 'tomorrow', 'week'].includes(nextAvailable))
            throw (0, errors_1.badRequest)('INVALID_NEXT_AVAILABLE', 'nextAvailable must be today|tomorrow|week');
        const p = {
            q, specialty, governorate, area, gender, language, nextAvailable: nextAvailable, sort: sort,
            minFee: num(minFee), maxFee: num(maxFee), minRating: num(minRating), lat: num(lat), lng: num(lng), maxDistanceKm: num(maxDistanceKm), page: num(page), pageSize: num(pageSize),
            acceptsDeposit: acceptsDeposit === undefined ? undefined : acceptsDeposit === 'true',
            careType, serviceLocation, district, profession,
        };
        return this.svc.search(p);
    }
    specialties() { return this.svc.specialties(); }
    profile(id) { return this.svc.profile(id); }
    async slots(id, typeId, from, to, serviceLocation, district, lat, lng) {
        if (!typeId)
            throw (0, errors_1.badRequest)('TYPE_REQUIRED', 'typeId required');
        const p = await this.svc.getRow(id);
        await this.markets.assertLive(p.market);
        const f = from ? new Date(from) : new Date();
        const t = to ? new Date(to) : new Date(f.getTime() + 7 * 86400_000);
        if (Number.isNaN(f.getTime()) || Number.isNaN(t.getTime()))
            throw (0, errors_1.badRequest)('INVALID_RANGE', 'invalid from/to');
        if (t.getTime() <= f.getTime())
            throw (0, errors_1.badRequest)('INVALID_RANGE', 'to must be after from');
        if (t.getTime() - f.getTime() > 92 * 86400_000)
            throw (0, errors_1.badRequest)('RANGE_TOO_LARGE', 'ask for at most 92 days of slots at a time');
        const loc = (serviceLocation ? String(serviceLocation).toUpperCase() : 'IN_CLINIC');
        if (!['IN_CLINIC', 'HOME'].includes(loc))
            throw (0, errors_1.badRequest)('INVALID_SERVICE_LOCATION', 'serviceLocation must be IN_CLINIC|HOME');
        let d;
        if (loc === 'HOME') {
            await this.flags.assertEnabled('kiorex.home_visits', { market: p.market });
            d = (0, provider_mapper_1.normalizeDistrict)(district) ?? undefined;
            if (!d)
                throw (0, errors_1.badRequest)('DISTRICT_REQUIRED', 'Home slots need the patient district code (e.g. nasr-city)');
            if (!this.svc.isHomeEnabled(p))
                throw (0, errors_1.conflict)('HOME_NOT_OFFERED', 'This provider does not offer home visits');
            if (!this.svc.coversDistrict(p, d))
                throw await this.svc.outOfCoverage(p, d);
        }
        await this.svc.track('slot_viewed', { providerId: id, serviceLocation: loc, district: d, careType: p.careType });
        return { providerId: id, typeId, serviceLocation: loc, district: d ?? null, slots: await this.svc.slots(p, typeId, f, t, { serviceLocation: loc, district: d, lat: num(lat), lng: num(lng) }) };
    }
    careTypes(market) { return this.svc.careTypes(market ?? 'EG'); }
    homeDistricts() { return this.svc.homeDistricts(); }
    view(id) { return this.svc.recordProfileView(id); }
    sponsored() { return { items: [], sponsored: true, label: 'SPONSORED' }; }
};
exports.CatalogController = CatalogController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.SearchResultDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('search/providers'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-DS-01..04/06 search; emergency keywords return 123 guidance and no results' }),
    __param(0, (0, common_1.Query)('q')),
    __param(1, (0, common_1.Query)('specialty')),
    __param(2, (0, common_1.Query)('governorate')),
    __param(3, (0, common_1.Query)('area')),
    __param(4, (0, common_1.Query)('minFee')),
    __param(5, (0, common_1.Query)('maxFee')),
    __param(6, (0, common_1.Query)('gender')),
    __param(7, (0, common_1.Query)('language')),
    __param(8, (0, common_1.Query)('minRating')),
    __param(9, (0, common_1.Query)('acceptsDeposit')),
    __param(10, (0, common_1.Query)('nextAvailable')),
    __param(11, (0, common_1.Query)('sort')),
    __param(12, (0, common_1.Query)('lat')),
    __param(13, (0, common_1.Query)('lng')),
    __param(14, (0, common_1.Query)('maxDistanceKm')),
    __param(15, (0, common_1.Query)('page')),
    __param(16, (0, common_1.Query)('pageSize')),
    __param(17, (0, common_1.Query)('careType')),
    __param(18, (0, common_1.Query)('serviceLocation')),
    __param(19, (0, common_1.Query)('district')),
    __param(20, (0, common_1.Query)('profession')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String, String, String, String, String, String, String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "search", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: shared_dto_1.SpecialtyDto, isArray: true }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('specialties'),
    (0, swagger_1.ApiOperation)({ summary: 'Specialty codes with AR/EN labels' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "specialties", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.ProviderProfileDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('providers/:id'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-PR-01/02/04 provider profile' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "profile", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.ProviderSlotsDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('providers/:id/slots'),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-BK-01 slots from Kiorly (60 s cache)' }),
    __param(0, (0, common_1.Param)('id')),
    __param(1, (0, common_1.Query)('typeId')),
    __param(2, (0, common_1.Query)('from')),
    __param(3, (0, common_1.Query)('to')),
    __param(4, (0, common_1.Query)('serviceLocation')),
    __param(5, (0, common_1.Query)('district')),
    __param(6, (0, common_1.Query)('lat')),
    __param(7, (0, common_1.Query)('lng')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String, String, String, String, String, String, String, String]),
    __metadata("design:returntype", Promise)
], CatalogController.prototype, "slots", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.CareTypeDto, isArray: true }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('care-types'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMDS01 care-type categories (Doctors · Physiotherapy · Home nursing) with enabled state (flags kiorex.category.*)' }),
    __param(0, (0, common_1.Query)('market')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "careTypes", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.HomeDistrictDto, isArray: true }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('home/districts'),
    (0, swagger_1.ApiOperation)({ summary: 'KXMHV02 districts with at least one home-enabled provider (district level only)' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "homeDistricts", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.ViewResultDto }),
    (0, auth_1.Public)(),
    (0, common_1.Post)('providers/:id/view'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'KXM-DS-08 count a profile view (pushed daily to Kiorly)' }),
    __param(0, (0, common_1.Param)('id')),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [String]),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "view", null);
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: catalog_dto_1.SponsoredResultDto }),
    (0, auth_1.Public)(),
    (0, common_1.Get)('search/sponsored'),
    (0, control_plane_public_1.RequiresFlag)('kiorex.sponsored_listings'),
    (0, swagger_1.ApiOperation)({ summary: 'Sponsored listings (P3, flag kiorex.sponsored_listings). No sponsorship commercial terms exist yet (NEEDS_HUMAN): always empty, always labelled' }),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", []),
    __metadata("design:returntype", void 0)
], CatalogController.prototype, "sponsored", null);
exports.CatalogController = CatalogController = __decorate([
    (0, swagger_1.ApiTags)('catalog'),
    (0, common_1.Controller)(),
    __metadata("design:paramtypes", [catalog_service_1.CatalogService, market_public_1.MarketService, control_plane_public_1.FlagsService])
], CatalogController);
//# sourceMappingURL=catalog.controller.js.map