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
exports.SlugBootstrapJob = exports.SlugBootstrapService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const prisma_service_1 = require("../../prisma/prisma.service");
const growth_flags_1 = require("../growth-flags");
const slug_service_1 = require("../slugs/slug.service");
const slug_names_1 = require("./slug-names");
const pick = (raw, ...path) => {
    let v = raw;
    for (const k of path)
        v = v && typeof v === 'object' ? v[k] : undefined;
    return typeof v === 'string' && v ? v : null;
};
let SlugBootstrapService = class SlugBootstrapService {
    prisma;
    slugs;
    constructor(prisma, slugs) {
        this.prisma = prisma;
        this.slugs = slugs;
    }
    async runOnce(o = {}) {
        const market = o.market ?? growth_flags_1.GROWTH_DEFAULT_MARKET;
        const dryRun = !!o.dryRun;
        const pageSize = o.pageSize ?? 500;
        const r = { market, dryRun, startedAt: new Date().toISOString(), considered: { DOCTOR: 0, CLINIC: 0, PHARMACY: 0, LAB: 0 }, created: { DOCTOR: 0, CLINIC: 0, PHARMACY: 0, LAB: 0 }, existing: 0, collisions: 0, fallbacks: 0 };
        const have = async (type, id) => !!(await this.prisma.growthSlug.findUnique({ where: { market_entityType_entityId: { market, entityType: type, entityId: id } }, select: { id: true } }));
        const one = async (type, id, names) => {
            r.considered[type]++;
            if (await have(type, id)) {
                r.existing++;
                return;
            }
            const proposal = (0, slug_names_1.proposeSlug)(names, type, id);
            if (proposal.source === 'FALLBACK')
                r.fallbacks++;
            if (dryRun) {
                r.created[type]++;
                return;
            }
            const slug = await this.slugs.ensure({ entityType: type, entityId: id, name: proposal.slug, market });
            r.created[type]++;
            if (slug !== proposal.slug)
                r.collisions++;
        };
        let cursor;
        const clinics = new Map();
        for (;;) {
            const rows = await this.prisma.provider.findMany({
                where: { market, status: { in: ['LIVE', 'PAUSED'] } }, orderBy: { id: 'asc' }, take: pageSize, ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
                select: { id: true, clinicId: true, nameEn: true, nameAr: true, clinicNameEn: true, clinicNameAr: true, raw: true },
            });
            if (!rows.length)
                break;
            for (const p of rows) {
                await one('DOCTOR', p.id, { bookingSlug: pick(p.raw, 'provider', 'bookingSlug') ?? pick(p.raw, 'bookingSlug'), nameEn: p.nameEn, nameAr: p.nameAr });
                if (!clinics.has(p.clinicId))
                    clinics.set(p.clinicId, { nameEn: p.clinicNameEn, nameAr: p.clinicNameAr, bookingSlug: pick(p.raw, 'clinic', 'bookingSlug') });
            }
            cursor = rows[rows.length - 1].id;
            if (rows.length < pageSize)
                break;
        }
        for (const [id, c] of [...clinics].sort(([a], [b]) => (a < b ? -1 : 1)))
            await one('CLINIC', id, c);
        const partners = await this.prisma.partnerConnection.findMany({ where: { market, status: 'LIVE', kind: { in: ['PHARMACY', 'LAB'] } }, orderBy: { id: 'asc' }, select: { id: true, kind: true, name: true, nameAr: true } });
        for (const pc of partners)
            await one(pc.kind, pc.id, { nameEn: pc.name, nameAr: pc.nameAr });
        return r;
    }
};
exports.SlugBootstrapService = SlugBootstrapService;
exports.SlugBootstrapService = SlugBootstrapService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, slug_service_1.SlugService])
], SlugBootstrapService);
let SlugBootstrapJob = class SlugBootstrapJob {
    svc;
    log = new common_1.Logger('growth-slug-bootstrap');
    timer;
    first;
    constructor(svc) {
        this.svc = svc;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        const run = () => void this.svc.runOnce().then((r) => { const n = Object.values(r.created).reduce((a, b) => a + b, 0); if (n)
            this.log.log(`slugs created: ${n}`); }).catch((e) => this.log.warn(`slug bootstrap failed: ${e.message}`));
        this.first = setTimeout(run, 20_000);
        this.first.unref();
        this.timer = setInterval(run, 15 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); if (this.first)
        clearTimeout(this.first); }
};
exports.SlugBootstrapJob = SlugBootstrapJob;
exports.SlugBootstrapJob = SlugBootstrapJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [SlugBootstrapService])
], SlugBootstrapJob);
//# sourceMappingURL=slug-bootstrap.service.js.map