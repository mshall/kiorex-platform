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
exports.SiteIndexService = void 0;
exports.declaresVideo = declaresVideo;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const market_public_1 = require("../market/market-public");
const prisma_service_1 = require("../prisma/prisma.service");
function declaresVideo(raw) {
    const prov = (raw?.provider) ?? {};
    const declared = [prov.telemedicine, prov.videoConsultation, ...(Array.isArray(prov.fees) ? prov.fees : []).map((f) => (f?.modality === 'VIDEO' || f?.isVideo === true ? true : f?.isVideo === false ? false : undefined))].filter((x) => x !== undefined);
    return declared.length ? declared.some(Boolean) : false;
}
let SiteIndexService = class SiteIndexService {
    prisma;
    flags;
    markets;
    cache = new Map();
    inflight = new Map();
    constructor(prisma, flags, markets) {
        this.prisma = prisma;
        this.flags = flags;
        this.markets = markets;
    }
    invalidate() { this.cache.clear(); }
    async get(market, ttlMs = 60_000) {
        const hit = this.cache.get(market);
        if (hit && Date.now() - hit.builtAt < ttlMs)
            return hit;
        const pending = this.inflight.get(market);
        if (pending)
            return pending;
        const p = this.build(market).then((i) => { this.cache.set(market, i); return i; }).finally(() => this.inflight.delete(market));
        this.inflight.set(market, p);
        return p;
    }
    async build(market) {
        const rows = await this.prisma.provider.findMany({
            where: { market, status: { in: ['LIVE', 'PAUSED'] } },
            select: {
                id: true, tenantId: true, clinicId: true, market: true, status: true, careType: true, profession: true, nameEn: true, nameAr: true, clinicNameEn: true, clinicNameAr: true,
                specialty: true, languages: true, governorate: true, area: true, minFeeMinor: true, maxFeeMinor: true, currency: true, ratingAvg: true, ratingCount: true, nextSlotAt: true,
                serviceLocations: true, coverageDistricts: true, sourceVersion: true, syncedAt: true, raw: true,
            },
            orderBy: { id: 'asc' },
        });
        const tenantListed = new Map();
        for (const t of new Set(rows.map((r) => r.tenantId).filter((x) => !!x))) {
            const d = await this.flags.evaluate('clinic.kiorex_listing', { market, orgId: t });
            tenantListed.set(t, d.effective || d.reason === 'DEPENDENCY_OFF');
        }
        const providers = rows.map((r) => {
            const v = new Date(r.sourceVersion);
            const { raw, ...rest } = r;
            return { ...rest, video: declaresVideo(raw), nextSlotAt: r.nextSlotAt, lastModified: Number.isNaN(v.getTime()) ? r.syncedAt : v, listed: r.tenantId ? tenantListed.get(r.tenantId) ?? true : true };
        });
        const [pharmacyOn, labOn] = await Promise.all([this.flags.isEnabled('kiorex.pharmacy_orders', { market }).catch(() => false), this.flags.isEnabled('kiorex.lab_bookings', { market }).catch(() => false)]);
        const pcs = pharmacyOn || labOn ? await this.prisma.partnerConnection.findMany({ where: { market, status: 'LIVE', kind: { in: ['PHARMACY', 'LAB'] } }, orderBy: { id: 'asc' }, select: { id: true, kind: true, name: true, nameAr: true, updatedAt: true } }) : [];
        const partners = pcs.filter((x) => (x.kind === 'PHARMACY' ? pharmacyOn : labOn)).map((x) => ({ id: x.id, kind: x.kind, nameEn: x.name, nameAr: x.nameAr, lastModified: x.updatedAt }));
        return { builtAt: Date.now(), market, providers, partners };
    }
    async marketLive(market) { return this.markets.isLive(market); }
    async liveMarkets() { return this.markets.liveMarkets(); }
};
exports.SiteIndexService = SiteIndexService;
exports.SiteIndexService = SiteIndexService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, market_public_1.MarketService])
], SiteIndexService);
//# sourceMappingURL=site-index.service.js.map