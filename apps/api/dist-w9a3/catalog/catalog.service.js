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
exports.CatalogService = exports.PROFESSION_BADGES = exports.CARE_TYPE_LABELS = exports.CARE_TYPE_FLAG = void 0;
const common_1 = require("@nestjs/common");
const client_1 = require("../prisma/generated/client");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const market_public_1 = require("../market/market-public");
const policy_public_1 = require("../policy/policy-public");
const prisma_service_1 = require("../prisma/prisma.service");
const safety_public_1 = require("../safety/safety-public");
const provider_mapper_1 = require("./provider-mapper");
exports.CARE_TYPE_FLAG = { DOCTORS: null, PHYSIOTHERAPY: 'kiorex.category.physiotherapy', HOME_NURSING: 'kiorex.category.nursing' };
exports.CARE_TYPE_LABELS = {
    DOCTORS: { en: 'Doctors', ar: 'أطباء' }, PHYSIOTHERAPY: { en: 'Physiotherapy', ar: 'علاج طبيعي' }, HOME_NURSING: { en: 'Home nursing', ar: 'تمريض منزلي' },
};
exports.PROFESSION_BADGES = {
    PHYSICIAN: { en: 'Verified doctor', ar: 'طبيب موثّق' }, DENTIST: { en: 'Verified dentist', ar: 'طبيب أسنان موثّق' },
    PHYSIOTHERAPIST: { en: 'Verified physiotherapist', ar: 'أخصائي علاج طبيعي موثّق' }, NURSE: { en: 'Verified nurse', ar: 'ممرض موثّق' },
};
const SYNC_CURSOR = 'catalog.sync.cursor';
async function mapLimit(xs, limit, fn) {
    const out = new Array(xs.length);
    let next = 0;
    await Promise.all(Array.from({ length: Math.min(limit, xs.length) }, async () => { while (next < xs.length) {
        const i = next++;
        out[i] = await fn(xs[i]);
    } }));
    return out;
}
let CatalogService = class CatalogService {
    prisma;
    kiorly;
    flags;
    markets;
    policy;
    log = new common_1.Logger('catalog');
    slotCache = new Map();
    timer;
    warmTimer;
    constructor(prisma, kiorly, flags, markets, policy) {
        this.prisma = prisma;
        this.kiorly = kiorly;
        this.flags = flags;
        this.markets = markets;
        this.policy = policy;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.syncOnce().catch((e) => this.log.warn(`provider sync failed: ${e.message}`)), 5 * 60_000);
        this.timer.unref();
        this.warmTimer = setInterval(() => void this.warmSlotIndex().catch((e) => this.log.warn(`slot index warm failed: ${e.message}`)), 60_000);
        this.warmTimer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); if (this.warmTimer)
        clearInterval(this.warmTimer); }
    async syncOnce(opts = {}) {
        const cursorRow = await this.prisma.kvState.findUnique({ where: { key: SYNC_CURSOR } });
        const since = opts.full ? undefined : cursorRow?.value?.updatedSince;
        let page = 1, upserted = 0, skipped = 0, maxUpdated = since ? new Date(since) : new Date(0);
        const seen = [];
        for (;;) {
            const { data } = await this.kiorly.listProviders({ updatedSince: since, page, pageSize: 100 });
            for (const dto of data.items ?? []) {
                const row = (0, provider_mapper_1.mapProviderDto)(dto);
                seen.push(row.id);
                const existing = await this.prisma.provider.findUnique({ where: { id: row.id }, select: { sourceVersion: true, specialty: true } });
                if (existing && existing.sourceVersion > row.sourceVersion && existing.specialty === row.specialty) {
                    skipped++;
                    continue;
                }
                const { id, raw, ...rest } = row;
                await this.prisma.provider.upsert({ where: { id }, create: { id, raw, ...rest }, update: { raw, ...rest, syncedAt: new Date() } });
                this.invalidateSlots(row.clinicianId);
                upserted++;
                const u = new Date(row.sourceVersion);
                if (u > maxUpdated)
                    maxUpdated = u;
            }
            if (page * (data.pageSize ?? 100) >= (data.total ?? 0) || !(data.items ?? []).length)
                break;
            page++;
        }
        if (opts.full)
            await this.prisma.provider.updateMany({ where: { id: { notIn: seen }, status: { in: ['LIVE', 'PAUSED'] } }, data: { status: 'DELISTED' } });
        if (maxUpdated.getTime() > 0)
            await this.prisma.kvState.upsert({ where: { key: SYNC_CURSOR }, create: { key: SYNC_CURSOR, value: { updatedSince: new Date(maxUpdated.getTime() - 1000).toISOString() } }, update: { value: { updatedSince: new Date(maxUpdated.getTime() - 1000).toISOString() } } });
        return { upserted, skipped, pages: page };
    }
    invalidateSlots(clinicianId) {
        void this.prisma.provider.updateMany({ where: clinicianId ? { clinicianId } : {}, data: { slotIndexedAt: null } }).catch(() => undefined);
        if (!clinicianId)
            return void this.slotCache.clear();
        for (const k of this.slotCache.keys())
            if (k.includes(`|${clinicianId}|`))
                this.slotCache.delete(k);
    }
    async refreshSlotIndex(staleWhere, o = {}) {
        const ttl = (0, config_1.cfg)().slotIndexTtlMs;
        const stale = client_1.Prisma.sql `(p."slotIndexedAt" IS NULL OR p."slotIndexedAt" < ${new Date(Date.now() - ttl)} OR (p."nextSlotAt" IS NOT NULL AND p."nextSlotAt" < now()))`;
        const w = staleWhere ? client_1.Prisma.sql `${staleWhere} AND ${stale}` : stale;
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT p.* FROM "Provider" p WHERE p.status = 'LIVE' AND ${w} ORDER BY p."slotIndexedAt" ASC NULLS FIRST, p.id LIMIT ${o.limit ?? 500}`);
        if (!rows.length)
            return { refreshed: 0, stale: 0 };
        const marketplaceOn = await this.flags.isEnabled('kiorex.marketplace', { market: 'EG' });
        const deadline = Date.now() + (o.deadlineMs ?? (0, config_1.cfg)().slotIndexDeadlineMs);
        let refreshed = 0;
        await mapLimit(rows, 8, async (r) => {
            if (Date.now() > deadline)
                return;
            const { typeId } = this.typeFor(r, 'IN_CLINIC');
            const homeOnly = r.serviceLocations.length > 0 && !r.serviceLocations.includes('IN_CLINIC');
            let next = null;
            if (marketplaceOn && typeId && !homeOnly) {
                try {
                    const from = new Date();
                    const slots = await this.slots(r, typeId, from, new Date(from.getTime() + 7 * 86400_000), { serviceLocation: 'IN_CLINIC' });
                    const first = slots.map((s) => new Date(s.startsAt).getTime()).filter((t) => t >= Date.now()).sort((a, b) => a - b)[0];
                    next = first !== undefined ? new Date(first) : null;
                }
                catch {
                    await this.prisma.provider.updateMany({ where: { id: r.id }, data: { slotIndexedAt: new Date(Date.now() - ttl + 30_000) } }).catch(() => undefined);
                    return;
                }
            }
            await this.prisma.provider.updateMany({ where: { id: r.id }, data: { nextSlotAt: next, slotIndexedAt: new Date() } });
            refreshed++;
        });
        return { refreshed, stale: rows.length };
    }
    async warmSlotIndex() {
        for (let i = 0; i < 20; i++) {
            const r = await this.refreshSlotIndex(null, { limit: 200, deadlineMs: 30_000 });
            if (r.stale < 200)
                break;
        }
    }
    async getRow(id) {
        const p = await this.prisma.provider.findUnique({ where: { id } });
        if (!p)
            throw (0, errors_1.notFound)('PROVIDER_NOT_FOUND', 'Provider not found');
        return p;
    }
    async profile(id) {
        const p = await this.getRow(id);
        await this.markets.assertLive(p.market);
        const raw = p.raw ?? {};
        const prov = raw.provider ?? {};
        const marketplaceOn = await this.flags.isEnabled('kiorex.marketplace', { market: p.market });
        return {
            id: p.id, status: p.status, bookable: p.status === 'LIVE' && marketplaceOn, nameEn: p.nameEn, nameAr: p.nameAr, specialty: p.specialty, subSpecialties: p.subSpecialties, languages: p.languages, gender: p.gender,
            titleEn: prov.titleEn ?? null, titleAr: prov.titleAr ?? null, photoUrl: prov.photoUrl ?? prov.photoRelativePath ?? null, verified: p.status === 'LIVE',
            fees: (prov.fees ?? []).map((f) => { const home = this.feeLocation(p, f) === 'HOME'; const sur = home ? Math.round(Number(f.homeSurcharge ?? 0) * 100) : 0; return { typeId: f.appointmentTypeId, nameEn: f.nameEn, nameAr: f.nameAr, amountMinor: Math.round(Number(f.amount) * 100), currency: f.currency, serviceLocation: home ? 'HOME' : 'IN_CLINIC', homeSurchargeMinor: sur, totalMinor: Math.round(Number(f.amount) * 100) + sur }; }),
            clinic: { id: p.clinicId, ...(raw.clinic ?? {}), phone: raw.clinic?.phone ?? null },
            rating: { average: p.ratingAvg, count: p.ratingCount },
            cancellationPolicy: prov.cancellationPolicy ?? raw.cancellationPolicy ?? null,
            acceptsDeposit: p.acceptsDeposit,
            profession: p.profession, careType: p.careType, edition: p.edition, professionBadge: p.profession ? exports.PROFESSION_BADGES[p.profession] ?? null : null, verificationRegister: p.verificationRegister,
            categoryEnabled: (await this.careTypeEnabled(p.careType, p.market)).enabled,
            serviceLocations: p.serviceLocations, assignsClinician: p.assignsClinician,
            homeVisit: { enabled: this.isHomeEnabled(p) && (await this.flags.isEnabled('kiorex.home_visits', { market: p.market })), coverageDistricts: p.coverageDistricts, homeSurchargeMinor: this.isHomeEnabled(p) ? p.homeSurchargeMinor ?? 0 : null },
            shareUrl: `${(0, config_1.cfg)().publicBaseUrl.replace(/:\d+$/, '')}/doctors/${p.id}`,
        };
    }
    depositFor(p, typeId, o = {}) {
        const f = (p.raw?.provider?.fees ?? []).find((x) => x.appointmentTypeId === typeId);
        if (f?.depositAmount)
            return { required: true, amountMinor: Math.round(Number(f.depositAmount) * 100) };
        const enabled = Boolean(p.acceptsDeposit || f?.depositRequired);
        const marketDefault = () => {
            if (!enabled || !f?.amount)
                return 0;
            const pol = this.policy.get('pay.deposit_default', { market: p.market, orgId: p.clinicId }).value;
            return (0, policy_public_1.depositFromPolicy)((0, policy_public_1.majorToMinor)(Number(f.amount), f.currency ?? 'EGP'), f.currency ?? 'EGP', pol);
        };
        if (o.home) {
            const amt = (0, config_1.cfg)().homeDepositDefaultMinor || (0, config_1.cfg)().depositDefaultMinor || marketDefault();
            return amt > 0 ? { required: true, amountMinor: amt, ...(!((0, config_1.cfg)().homeDepositDefaultMinor || (0, config_1.cfg)().depositDefaultMinor) && { policy: 'MARKET_DEFAULT_PERCENT' }) } : { required: false, amountMinor: 0, policy: 'HOME_DEFAULT_REQUIRED_AMOUNT_UNSET' };
        }
        if (enabled && (0, config_1.cfg)().depositDefaultMinor > 0)
            return { required: true, amountMinor: (0, config_1.cfg)().depositDefaultMinor };
        const pct = marketDefault();
        if (pct > 0)
            return { required: true, amountMinor: pct, policy: 'MARKET_DEFAULT_PERCENT' };
        return { required: false, amountMinor: 0 };
    }
    feeFor(p, typeId) {
        const f = (p.raw?.provider?.fees ?? []).find((x) => x.appointmentTypeId === typeId);
        return f ? Math.round(Number(f.amount) * 100) : null;
    }
    async slots(p, typeId, from, to, opts = {}) {
        const home = opts.serviceLocation === 'HOME';
        const district = home ? opts.district : undefined;
        const key = `${p.clinicId}|${p.clinicianId}|${typeId}|${from.toISOString().slice(0, 13)}|${to.toISOString().slice(0, 13)}|${home ? `HOME:${district ?? ''}` : 'IN_CLINIC'}`;
        const hit = this.slotCache.get(key);
        if (!opts.fresh && hit && Date.now() - hit.at < (0, config_1.cfg)().slotCacheTtlMs)
            return hit.slots;
        try {
            const { data } = await this.kiorly.slots(p.clinicId, { clinicianId: p.clinicianId, typeId, from: from.toISOString(), to: to.toISOString(), ...(home ? { serviceLocation: 'HOME', district, lat: opts.lat, lng: opts.lng } : {}) });
            const slots = (data?.slots ?? data ?? []).map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt, serviceLocation: (s.serviceLocation === 'HOME' || home ? 'HOME' : 'IN_CLINIC'), district: s.district ?? (home ? district ?? null : null) }));
            this.slotCache.set(key, { at: Date.now(), slots });
            return slots;
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError && e.status === 404)
                throw (0, errors_1.notFound)('LISTING_NOT_LIVE', 'Listing is not live');
            if (e instanceof kiorly_public_1.KiorlyHttpError && e.status === 422 && (e.code === 'OUT_OF_COVERAGE' || e.body?.code === 'OUT_OF_COVERAGE'))
                throw await this.outOfCoverage(p, district ?? e.body?.district, e.body?.alternatives);
            if (e instanceof kiorly_public_1.KiorlyTransientError)
                throw (0, errors_1.unavailable)('CLINIC_SYSTEM_BUSY', 'Clinic system busy, try again shortly');
            throw e;
        }
    }
    async outOfCoverage(p, district, alternatives) {
        const d = (0, provider_mapper_1.normalizeDistrict)(district) ?? undefined;
        const suggested = d ? await this.prisma.provider.findMany({ where: { status: 'LIVE', careType: p.careType, id: { not: p.id }, serviceLocations: { has: 'HOME' }, coverageDistricts: { has: d } }, take: 3, select: { id: true, nameEn: true, nameAr: true, careType: true } }) : [];
        return new errors_1.ApiError(422, 'OUT_OF_COVERAGE', 'This provider does not visit your district', {
            district: d, coverageDistricts: p.coverageDistricts, alternatives: Array.isArray(alternatives) ? alternatives : [], suggestedProviders: suggested,
            explanation: { en: 'This provider does not visit your district yet. Pick another address or another provider.', ar: 'هذا المقدم لا يغطي منطقتك حاليًا. اختر عنوانًا آخر أو مقدمًا آخر.' },
        });
    }
    coversDistrict(p, district) {
        return p.coverageDistricts.length === 0 ? true : p.coverageDistricts.includes(district);
    }
    isHomeEnabled(p) { return p.serviceLocations.includes('HOME'); }
    feeLocation(p, f) { return (f?.serviceLocation ?? (p.serviceLocations.length === 1 ? p.serviceLocations[0] : 'IN_CLINIC')); }
    typeFor(p, location) {
        const fees = (p.raw?.provider?.fees ?? []);
        const want = fees.find((f) => this.feeLocation(p, f) === location);
        const f = want ?? (location === 'HOME' && !p.serviceLocations.includes('HOME') ? undefined : fees[0]);
        return { typeId: f?.appointmentTypeId, fee: f };
    }
    async careTypeEnabled(ct, market = 'EG') {
        const key = exports.CARE_TYPE_FLAG[ct];
        if (!key)
            return { enabled: true, key: null, reason: 'ON', scope: undefined };
        const r = await this.flags.evaluate(key, { market });
        return { enabled: r.effective, key, reason: r.reason, scope: r.scope };
    }
    async careTypes(market = 'EG') {
        const counts = await this.prisma.provider.groupBy({ by: ['careType'], where: { status: 'LIVE' }, _count: true });
        return Promise.all(provider_mapper_1.CARE_TYPES.map(async (code) => { const e = await this.careTypeEnabled(code, market); return { code, labelEn: exports.CARE_TYPE_LABELS[code].en, labelAr: exports.CARE_TYPE_LABELS[code].ar, enabled: e.enabled, flag: e.key, reason: e.reason, providerCount: e.enabled ? counts.find((c) => c.careType === code)?._count ?? 0 : 0 }; }));
    }
    async homeDistricts() {
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT d AS district, min(p.governorate) AS governorate, count(*)::bigint AS providers
      FROM "Provider" p, unnest(p."coverageDistricts") AS d
      WHERE p.status = 'LIVE' AND 'HOME' = ANY(p."serviceLocations") GROUP BY d ORDER BY d`);
        return rows.map((r) => ({ district: r.district, governorate: r.governorate, homeEnabledProviders: Number(r.providers) }));
    }
    async homeGateMetric(min = (0, config_1.cfg)().homeGateMinProviders) {
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `
      SELECT lower(coalesce(governorate, 'unknown')) AS cluster, count(*)::bigint AS providers,
        count(*) FILTER (WHERE "careType" = 'PHYSIOTHERAPY')::bigint AS physios, count(*) FILTER (WHERE "careType" = 'HOME_NURSING')::bigint AS nurses
      FROM "Provider" WHERE status = 'LIVE' AND 'HOME' = ANY("serviceLocations") GROUP BY 1 ORDER BY 1`);
        const clusters = rows.map((r) => ({ cluster: r.cluster ?? 'unknown', homeEnabledProviders: Number(r.providers), byCareType: { doctors: Number(r.providers) - Number(r.physios) - Number(r.nurses), physiotherapy: Number(r.physios), homeNursing: Number(r.nurses) }, threshold: min, met: Number(r.providers) >= min }));
        return { threshold: min, clusterBasis: 'governorate', clusters, anyMet: clusters.some((c) => c.met), allMet: clusters.length > 0 && clusters.every((c) => c.met) };
    }
    async search(q) {
        const emergency = (0, safety_public_1.detectEmergency)(q.q);
        const finite = (n, d) => (typeof n === 'number' && Number.isFinite(n) ? Math.floor(n) : d);
        const page = Math.min(100_000, Math.max(1, finite(q.page, 1)));
        const pageSize = Math.min(30, Math.max(1, finite(q.pageSize, 10)));
        if (emergency.emergency) {
            await this.track('emergency_guidance_shown', { code: emergency.categories[0] });
            return { emergency: { ...safety_public_1.EMERGENCY_GUIDANCE, categories: emergency.categories }, items: [], total: 0, page, pageSize, specialties: [] };
        }
        const mapped = q.q ? (0, safety_public_1.mapSymptomToSpecialties)(q.q) : [];
        const live = await this.markets.liveMarkets();
        if (!live.length)
            return { items: [], total: 0, page, pageSize, sort: q.sort ?? 'earliest', specialties: [], marketsLive: [] };
        const where = [client_1.Prisma.sql `p.status = 'LIVE'`, client_1.Prisma.sql `p.market IN (${client_1.Prisma.join(live)})`];
        let careType;
        if (q.careType) {
            careType = String(q.careType).toUpperCase();
            if (!provider_mapper_1.CARE_TYPES.includes(careType))
                throw (0, errors_1.badRequest)('INVALID_CARE_TYPE', `careType must be ${provider_mapper_1.CARE_TYPES.join('|')}`);
            const e = await this.careTypeEnabled(careType);
            if (!e.enabled)
                await this.flags.assertEnabled(e.key, { market: 'EG' });
            where.push(client_1.Prisma.sql `p."careType" = ${careType}`);
        }
        else {
            const on = [];
            for (const ct of provider_mapper_1.CARE_TYPES)
                if ((await this.careTypeEnabled(ct)).enabled)
                    on.push(ct);
            where.push(client_1.Prisma.sql `p."careType" IN (${client_1.Prisma.join(on)})`);
        }
        const location = q.serviceLocation ? String(q.serviceLocation).toUpperCase() : undefined;
        if (location && !['IN_CLINIC', 'HOME'].includes(location))
            throw (0, errors_1.badRequest)('INVALID_SERVICE_LOCATION', 'serviceLocation must be IN_CLINIC|HOME');
        const homeOn = await this.flags.isEnabled('kiorex.home_visits', { market: 'EG' });
        const district = q.district === undefined || q.district === '' ? undefined : (0, provider_mapper_1.normalizeDistrict)(q.district) ?? undefined;
        if (q.district && !district)
            throw (0, errors_1.badRequest)('INVALID_DISTRICT', 'district must be a district code such as "nasr-city" (never an address)');
        if (location === 'HOME') {
            if (!homeOn)
                await this.flags.assertEnabled('kiorex.home_visits', { market: 'EG' });
            if (!district)
                throw (0, errors_1.badRequest)('DISTRICT_REQUIRED', 'Home search needs the patient district');
            where.push(client_1.Prisma.sql `'HOME' = ANY(p."serviceLocations") AND ${district} = ANY(p."coverageDistricts")`);
        }
        else if (location === 'IN_CLINIC')
            where.push(client_1.Prisma.sql `('IN_CLINIC' = ANY(p."serviceLocations") OR cardinality(p."serviceLocations") = 0)`);
        else if (!homeOn)
            where.push(client_1.Prisma.sql `('IN_CLINIC' = ANY(p."serviceLocations") OR cardinality(p."serviceLocations") = 0)`);
        if (q.profession)
            where.push(client_1.Prisma.sql `p.profession = ${String(q.profession).toUpperCase()}`);
        const specialty = q.specialty && (0, safety_public_1.isSpecialtyCode)(q.specialty) ? q.specialty : q.specialty;
        if (specialty)
            where.push(client_1.Prisma.sql `p.specialty = ${specialty}`);
        if (q.q?.trim()) {
            const n = (0, safety_public_1.normalizeText)(q.q);
            const toks = n.split(' ').filter((t) => t.length >= 2);
            const like = toks.length ? client_1.Prisma.join(toks.map((t) => client_1.Prisma.sql `p."searchText" ILIKE ${'%' + t + '%'}`), ' AND ') : client_1.Prisma.sql `TRUE`;
            const specs = mapped.length ? client_1.Prisma.sql `OR p.specialty IN (${client_1.Prisma.join(mapped)})` : client_1.Prisma.empty;
            where.push(client_1.Prisma.sql `((${like}) OR similarity(p."searchText", ${n}) > 0.25 ${specs})`);
        }
        if (q.governorate)
            where.push(client_1.Prisma.sql `lower(p.governorate) = ${q.governorate.toLowerCase()}`);
        if (q.area)
            where.push(client_1.Prisma.sql `lower(p.area) = ${q.area.toLowerCase()}`);
        if (q.minFee !== undefined)
            where.push(client_1.Prisma.sql `p."maxFeeMinor" >= ${Math.round(q.minFee * 100)}`);
        if (q.maxFee !== undefined)
            where.push(client_1.Prisma.sql `p."minFeeMinor" <= ${Math.round(q.maxFee * 100)}`);
        if (q.gender)
            where.push(client_1.Prisma.sql `p.gender = ${q.gender.toUpperCase()}`);
        if (q.language)
            where.push(client_1.Prisma.sql `${q.language.toLowerCase()} = ANY(p.languages)`);
        if (q.minRating !== undefined)
            where.push(client_1.Prisma.sql `p."ratingAvg" >= ${q.minRating}`);
        if (q.acceptsDeposit !== undefined)
            where.push(client_1.Prisma.sql `p."acceptsDeposit" = ${q.acceptsDeposit}`);
        const hasGeo = q.lat !== undefined && q.lng !== undefined;
        const dist = hasGeo
            ? client_1.Prisma.sql `(6371 * acos(least(1, cos(radians(${q.lat})) * cos(radians(p.latitude)) * cos(radians(p.longitude) - radians(${q.lng})) + sin(radians(${q.lat})) * sin(radians(p.latitude)))))`
            : client_1.Prisma.sql `NULL::float`;
        if (hasGeo && q.maxDistanceKm)
            where.push(client_1.Prisma.sql `p.latitude IS NOT NULL AND ${dist} <= ${q.maxDistanceKm}`);
        const sort = q.sort ?? 'earliest';
        const tenants = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT DISTINCT p."tenantId" t, p.market m FROM "Provider" p WHERE p."tenantId" IS NOT NULL AND ${client_1.Prisma.join(where, ' AND ')}`);
        const hidden = [];
        for (const t of tenants) {
            const d = await this.flags.evaluate('clinic.kiorex_listing', { market: t.m, orgId: t.t });
            if (!(d.effective || d.reason === 'DEPENDENCY_OFF'))
                hidden.push(t.t);
        }
        if (hidden.length)
            where.push(client_1.Prisma.sql `(p."tenantId" IS NULL OR p."tenantId" NOT IN (${client_1.Prisma.join(hidden)}))`);
        const whereSql = client_1.Prisma.join(where, ' AND ');
        const wantsSlots = sort === 'earliest' || !!q.nextAvailable;
        const indexed = wantsSlots && location !== 'HOME';
        const memorySlotSort = wantsSlots && !indexed;
        let slotWhere = whereSql;
        if (indexed) {
            await this.refreshSlotIndex(whereSql);
            if (q.nextAvailable) {
                const end = new Date();
                end.setUTCHours(23, 59, 59, 999);
                if (q.nextAvailable === 'tomorrow')
                    end.setUTCDate(end.getUTCDate() + 1);
                if (q.nextAvailable === 'week')
                    end.setUTCDate(end.getUTCDate() + 7);
                slotWhere = client_1.Prisma.sql `${whereSql} AND p."nextSlotAt" >= now() AND p."nextSlotAt" <= ${end}`;
            }
        }
        const tie = client_1.Prisma.sql `, p.id ASC`;
        const earliestOrder = client_1.Prisma.sql `(CASE WHEN p."nextSlotAt" >= now() THEN p."nextSlotAt" END) ASC NULLS LAST, p."ratingAvg" DESC, p."ratingCount" DESC${tie}`;
        const order = sort === 'distance' && hasGeo ? client_1.Prisma.sql `distance ASC NULLS LAST${tie}` : sort === 'rating' ? client_1.Prisma.sql `p."ratingAvg" DESC, p."ratingCount" DESC${tie}` : sort === 'fee' ? client_1.Prisma.sql `p."minFeeMinor" ASC NULLS LAST${tie}` : indexed ? earliestOrder : client_1.Prisma.sql `p."ratingAvg" DESC, p."ratingCount" DESC${tie}`;
        const limit = memorySlotSort ? 120 : pageSize;
        const offset = memorySlotSort ? 0 : (page - 1) * pageSize;
        const rows = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT p.*, ${dist} AS distance FROM "Provider" p WHERE ${slotWhere} ORDER BY ${order} LIMIT ${limit} OFFSET ${offset}`);
        const totalRow = await this.prisma.$queryRaw(client_1.Prisma.sql `SELECT count(*)::bigint c FROM "Provider" p WHERE ${slotWhere}`);
        let total = Number(totalRow[0]?.c ?? 0);
        const visible = rows;
        const marketplaceOn = await this.flags.isEnabled('kiorex.marketplace', { market: 'EG' });
        const items = await mapLimit(visible, 8, async (r) => {
            const loc = location ?? (r.serviceLocations.includes('IN_CLINIC') || !r.serviceLocations.length ? 'IN_CLINIC' : 'HOME');
            const { typeId, fee } = this.typeFor(r, loc);
            let nextSlots = null;
            let slotsUnavailable = false;
            if (marketplaceOn && typeId && (loc === 'IN_CLINIC' || (district && homeOn))) {
                try {
                    const from = new Date();
                    nextSlots = (await this.slots(r, typeId, from, new Date(from.getTime() + 7 * 86400_000), { serviceLocation: loc, district })).slice(0, 3);
                }
                catch {
                    slotsUnavailable = true;
                }
            }
            const base = fee ? Math.round(Number(fee.amount) * 100) : null;
            const sur = fee?.homeSurcharge ? Math.round(Number(fee.homeSurcharge) * 100) : r.homeSurchargeMinor ?? 0;
            return {
                profession: r.profession, careType: r.careType, edition: r.edition, serviceLocations: r.serviceLocations, coverageDistricts: r.coverageDistricts, assignsClinician: r.assignsClinician,
                professionBadge: r.profession ? exports.PROFESSION_BADGES[r.profession] ?? null : null,
                homeVisit: { enabled: this.isHomeEnabled(r) && homeOn, homeSurchargeMinor: this.isHomeEnabled(r) ? sur : null, visitFeeIncludingSurchargeMinor: loc === 'HOME' && base !== null ? base + sur : null },
                id: r.id, nameEn: r.nameEn, nameAr: r.nameAr, clinicNameEn: r.clinicNameEn, clinicNameAr: r.clinicNameAr, specialty: r.specialty, governorate: r.governorate, area: r.area,
                minFeeMinor: r.minFeeMinor, maxFeeMinor: r.maxFeeMinor, currency: r.currency, rating: { average: r.ratingAvg, count: r.ratingCount }, acceptsDeposit: r.acceptsDeposit, languages: r.languages, gender: r.gender,
                distanceKm: r.distance, verified: true,
                ...(r.serviceLocations.includes('IN_CLINIC') && r.latitude != null && r.longitude != null ? { latitude: r.latitude, longitude: r.longitude } : {}), bookable: marketplaceOn && !!typeId && (loc === 'IN_CLINIC' || homeOn), defaultTypeId: typeId ?? null, defaultServiceLocation: loc, nextSlots, slotsUnavailable, sponsored: false,
                ...(marketplaceOn ? {} : { clinicPhone: r.raw?.clinic?.phone ?? null }),
            };
        });
        let out = items;
        if (q.nextAvailable && memorySlotSort) {
            const end = new Date();
            end.setUTCHours(23, 59, 59, 999);
            if (q.nextAvailable === 'tomorrow')
                end.setUTCDate(end.getUTCDate() + 1);
            if (q.nextAvailable === 'week')
                end.setUTCDate(end.getUTCDate() + 7);
            out = out.filter((i) => i.nextSlots?.[0] && new Date(i.nextSlots[0].startsAt) <= end);
            total = out.length;
        }
        if (memorySlotSort) {
            out.sort((a, b) => (a.nextSlots?.[0] ? new Date(a.nextSlots[0].startsAt).getTime() : Infinity) - (b.nextSlots?.[0] ? new Date(b.nextSlots[0].startsAt).getTime() : Infinity) || (b.rating.average - a.rating.average) || (b.rating.count - a.rating.count) || (a.id < b.id ? -1 : 1));
            out = out.slice((page - 1) * pageSize, page * pageSize);
        }
        await this.track('results_viewed', { code: q.q ? 'keyword' : 'browse', specialtyCode: specialty ?? mapped[0], careType, serviceLocation: location, district });
        return { items: out, total, page, pageSize, sort, specialties: mapped.map((c) => ({ code: c, ...safety_public_1.SPECIALTY_LABELS[c] })) };
    }
    specialties() {
        return safety_public_1.SPECIALTY_CODES.map((code) => ({ code, ...safety_public_1.SPECIALTY_LABELS[code] })).sort((a, b) => a.en.localeCompare(b.en, 'en'));
    }
    async track(name, d = {}) {
        await this.prisma.analyticsEvent.create({ data: { name, specialtyCode: d.specialtyCode, providerId: d.providerId, code: d.code, market: d.market ?? 'EG', district: (0, provider_mapper_1.normalizeDistrict)(d.district) ?? undefined, careType: d.careType, serviceLocation: d.serviceLocation } }).catch(() => undefined);
    }
    async recordProfileView(providerId) {
        const p = await this.getRow(providerId);
        const date = new Date(new Date().toISOString().slice(0, 10));
        await this.prisma.profileViewDaily.upsert({ where: { providerId_date: { providerId: p.id, date } }, create: { providerId: p.id, date, views: 1 }, update: { views: { increment: 1 }, pushedAt: null } });
        return { ok: true };
    }
    async pushProfileViews() {
        const today = new Date(new Date().toISOString().slice(0, 10));
        const rows = await this.prisma.profileViewDaily.findMany({ where: { pushedAt: null, date: { lt: today } } });
        if (!rows.length)
            return { pushed: 0 };
        const providers = await this.prisma.provider.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.providerId))] } } });
        const byProv = new Map(providers.map((p) => [p.id, p]));
        const byClinic = new Map();
        for (const r of rows) {
            const p = byProv.get(r.providerId);
            if (!p)
                continue;
            const list = byClinic.get(p.clinicId) ?? [];
            list.push({ clinicianId: p.clinicianId, date: r.date.toISOString().slice(0, 10), views: r.views });
            byClinic.set(p.clinicId, list);
        }
        let pushed = 0;
        for (const [clinicId, items] of byClinic) {
            for (let i = 0; i < items.length; i += 400) {
                const chunk = items.slice(i, i + 400);
                await this.kiorly.syncProfileViews({ clinicId, items: chunk });
                pushed += chunk.length;
            }
        }
        await this.prisma.profileViewDaily.updateMany({ where: { pushedAt: null, date: { lt: today } }, data: { pushedAt: new Date() } });
        return { pushed };
    }
    async opsList(q) {
        const take = Math.min(Math.max(1, Number.isFinite(q.take) ? Math.floor(q.take) : 50), 200);
        const page = Math.min(100_000, Math.max(1, Number.isFinite(q.page) ? Math.floor(q.page) : 1));
        const where = { ...(q.status ? { status: q.status } : {}), ...(q.q ? { searchText: { contains: (0, safety_public_1.normalizeText)(q.q) } } : {}) };
        const [total, rows] = await Promise.all([this.prisma.provider.count({ where }), this.prisma.provider.findMany({ where, orderBy: { syncedAt: 'desc' }, take, skip: (page - 1) * take, select: { id: true, profession: true, careType: true, serviceLocations: true, coverageDistricts: true, clinicId: true, clinicianId: true, status: true, nameEn: true, nameAr: true, specialty: true, governorate: true, ratingAvg: true, ratingCount: true, sourceVersion: true, syncedAt: true } })]);
        return { total, items: rows };
    }
    async updateRating(providerId, avg, count) {
        await this.prisma.provider.updateMany({ where: { id: providerId }, data: { ratingAvg: avg, ratingCount: count } });
    }
};
exports.CatalogService = CatalogService;
exports.CatalogService = CatalogService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, kiorly_public_1.KiorlyClient, control_plane_public_1.FlagsService, market_public_1.MarketService, policy_public_1.PolicyService])
], CatalogService);
//# sourceMappingURL=catalog.service.js.map