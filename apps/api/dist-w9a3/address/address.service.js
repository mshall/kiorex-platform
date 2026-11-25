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
exports.AddressService = exports.MAX_ADDRESSES = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const district_1 = require("../common/district");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
const maps_adapter_1 = require("./maps.adapter");
exports.MAX_ADDRESSES = 10;
let AddressService = class AddressService {
    prisma;
    patients;
    log = new common_1.Logger('address');
    timer;
    constructor(prisma, patients) {
        this.prisma = prisma;
        this.patients = patients;
    }
    onModuleInit() {
        this.patients.registerExport('addresses', async (sub) => (await this.prisma.patientAddress.findMany({ where: { sub, deletedAt: null } })).map((a) => ({ id: a.id, label: a.label, governorate: a.governorate, district: a.district, confirmed: !!a.confirmedAt, doorstepLines: 'encrypted: available in-app' })));
        this.patients.registerAnonymizer('addresses', async (sub) => {
            const wiped = (0, crypto_1.encryptField)('{}');
            await this.prisma.patientAddress.updateMany({ where: { sub }, data: { addressEnc: wiped, deletedAt: new Date(), label: 'deleted' } });
            await this.prisma.bookingVisitAddress.updateMany({ where: { sub }, data: { addressEnc: null, maskedAt: new Date() } });
        });
        if ((0, config_1.cfg)().jobsEnabled) {
            this.timer = setInterval(() => void this.maskExpired().catch((e) => this.log.warn(`address mask sweep failed: ${e.message}`)), 15 * 60_000);
            this.timer.unref();
        }
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    lines(a) { return JSON.parse((0, crypto_1.decryptField)(a.addressEnc)); }
    present(a) {
        const l = this.lines(a);
        return {
            id: a.id, label: a.label, governorate: a.governorate, district: a.district,
            street: l.street ?? null, building: l.building ?? null, floor: l.floor ?? null, flat: l.flat ?? null, landmark: l.landmark ?? null,
            lat: l.lat ?? null, lng: l.lng ?? null, hasPin: l.lat !== undefined && l.lng !== undefined, pinSource: l.pinSource ?? null,
            confirmed: !!a.confirmedAt, confirmedAt: a.confirmedAt, isDefault: a.isDefault, createdAt: a.createdAt,
            summary: `${a.label} · ${a.district} · ${a.governorate}`,
        };
    }
    async list(sub) {
        const rows = await this.prisma.patientAddress.findMany({ where: { sub, deletedAt: null }, orderBy: [{ isDefault: 'desc' }, { createdAt: 'asc' }] });
        return rows.map((r) => this.present(r));
    }
    async owned(sub, id) {
        const a = await this.prisma.patientAddress.findFirst({ where: { id, sub, deletedAt: null } });
        if (!a)
            throw (0, errors_1.notFound)('ADDRESS_NOT_FOUND', 'Address not found');
        return a;
    }
    validate(i, partial) {
        if (!partial || i.district !== undefined) {
            if (!(0, district_1.normalizeDistrict)(i.district))
                throw (0, errors_1.badRequest)('INVALID_DISTRICT', 'district must be a district code from GET /home/districts (e.g. nasr-city), not an address line');
        }
        if (!partial && !i.street?.trim())
            throw (0, errors_1.badRequest)('STREET_REQUIRED', 'street is required');
        if ((i.lat === undefined) !== (i.lng === undefined))
            throw (0, errors_1.badRequest)('INVALID_PIN', 'lat and lng must be given together');
    }
    async create(u, i) {
        await this.patients.ensureProfile(u);
        this.validate(i, false);
        const count = await this.prisma.patientAddress.count({ where: { sub: u.sub, deletedAt: null } });
        if (count >= exports.MAX_ADDRESSES)
            throw (0, errors_1.conflict)('ADDRESS_LIMIT', `At most ${exports.MAX_ADDRESSES} saved addresses`);
        const district = (0, district_1.normalizeDistrict)(i.district);
        const lines = { street: i.street.trim(), building: i.building?.trim() || undefined, floor: i.floor?.trim() || undefined, flat: i.flat?.trim() || undefined, landmark: i.landmark?.trim() || undefined };
        if (i.lat !== undefined && i.lng !== undefined) {
            lines.lat = i.lat;
            lines.lng = i.lng;
            lines.pinSource = 'USER';
        }
        else {
            try {
                const g = await (0, maps_adapter_1.mapsAdapter)().geocode({ governorate: i.governorate, district, street: i.street });
                lines.lat = g.lat;
                lines.lng = g.lng;
                lines.pinSource = 'GEOCODED';
            }
            catch { }
        }
        const makeDefault = i.makeDefault || count === 0;
        const row = await this.prisma.$transaction(async (tx) => {
            if (makeDefault)
                await tx.patientAddress.updateMany({ where: { sub: u.sub, isDefault: true }, data: { isDefault: false } });
            return tx.patientAddress.create({ data: { id: (0, ids_1.newId)('kx_ad'), sub: u.sub, label: i.label.trim(), governorate: i.governorate.trim(), district, addressEnc: (0, crypto_1.encryptField)(JSON.stringify(lines)), isDefault: makeDefault } });
        });
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'address.created', resource: 'PatientAddress', resourceId: row.id, metadata: (0, district_1.addressForLog)(row) } });
        return this.present(row);
    }
    async update(u, id, i) {
        const a = await this.owned(u.sub, id);
        this.validate(i, true);
        const cur = this.lines(a);
        const next = { ...cur };
        for (const k of ['street', 'building', 'floor', 'flat', 'landmark'])
            if (i[k] !== undefined)
                next[k] = i[k]?.trim() || undefined;
        if (i.lat !== undefined && i.lng !== undefined) {
            next.lat = i.lat;
            next.lng = i.lng;
            next.pinSource = 'USER';
        }
        const district = i.district !== undefined ? (0, district_1.normalizeDistrict)(i.district) : a.district;
        const moved = district !== a.district || (i.street !== undefined && i.street.trim() !== cur.street);
        const row = await this.prisma.$transaction(async (tx) => {
            if (i.makeDefault)
                await tx.patientAddress.updateMany({ where: { sub: u.sub, isDefault: true }, data: { isDefault: false } });
            return tx.patientAddress.update({ where: { id }, data: { ...(i.label !== undefined ? { label: i.label.trim() } : {}), ...(i.governorate !== undefined ? { governorate: i.governorate.trim() } : {}), district, addressEnc: (0, crypto_1.encryptField)(JSON.stringify(next)), ...(i.makeDefault ? { isDefault: true } : {}), ...(moved ? { confirmedAt: null, confirmedPhoneLast4: null } : {}) } });
        });
        return this.present(row);
    }
    async remove(sub, id) {
        const a = await this.owned(sub, id);
        await this.prisma.patientAddress.update({ where: { id: a.id }, data: { deletedAt: new Date(), addressEnc: (0, crypto_1.encryptField)('{}'), isDefault: false } });
        return { ok: true };
    }
    async confirm(u, id) {
        const a = await this.owned(u.sub, id);
        const profile = await this.patients.profileBySub(u.sub);
        if (!u.phone)
            throw (0, errors_1.conflict)('PHONE_NOT_VERIFIED', 'A phone verified with a one-time code is required to confirm an address');
        if (profile?.phone && profile.phone !== u.phone)
            throw (0, errors_1.conflict)('PHONE_MISMATCH', 'The verified phone does not match your profile phone');
        const row = await this.prisma.patientAddress.update({ where: { id: a.id }, data: { confirmedAt: new Date(), confirmedPhoneLast4: u.phone.slice(-4) } });
        await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'address.confirmed', resource: 'PatientAddress', resourceId: row.id, metadata: (0, district_1.addressForLog)(row) } });
        return this.present(row);
    }
    async resolveForBooking(sub, addressId) {
        const a = await this.owned(sub, addressId);
        if (!a.confirmedAt) {
            const anyConfirmed = await this.prisma.patientAddress.count({ where: { sub, deletedAt: null, confirmedAt: { not: null } } });
            if (!anyConfirmed)
                throw (0, errors_1.conflict)('ADDRESS_NOT_CONFIRMED', 'Confirm an address with your verified phone before your first home booking', { addressId: a.id });
        }
        const l = this.lines(a);
        const visit = { district: a.district, line1: l.street, building: l.building, floor: l.floor, flat: l.flat, landmark: l.landmark, lat: l.lat, lng: l.lng };
        return { row: a, visit };
    }
    async rowFor(sub, id) { return this.prisma.patientAddress.findFirst({ where: { id, sub, deletedAt: null } }); }
    async snapshot(bookingId, sub, a) {
        await this.prisma.bookingVisitAddress.upsert({ where: { bookingId }, create: { bookingId, sub, governorate: a.governorate, district: a.district, addressEnc: a.addressEnc }, update: {} });
    }
    async scheduleMask(bookingId, endedAt = new Date()) {
        await this.prisma.bookingVisitAddress.updateMany({ where: { bookingId, maskAfter: null }, data: { maskAfter: new Date(endedAt.getTime() + (0, config_1.cfg)().addressMaskHours * 3600_000) } });
    }
    async maskExpired(now = new Date()) {
        const r = await this.prisma.bookingVisitAddress.updateMany({ where: { maskAfter: { lte: now }, maskedAt: null }, data: { addressEnc: null, maskedAt: now } });
        return r.count;
    }
    async forBooking(bookingId) {
        const v = await this.prisma.bookingVisitAddress.findUnique({ where: { bookingId } });
        if (!v)
            return null;
        const expired = !!v.maskAfter && v.maskAfter <= new Date();
        const masked = !!v.maskedAt || expired || !v.addressEnc;
        if (masked)
            return { district: v.district, governorate: v.governorate, masked: true, maskedAt: v.maskedAt ?? v.maskAfter ?? null, address: null };
        const l = JSON.parse((0, crypto_1.decryptField)(v.addressEnc));
        return { district: v.district, governorate: v.governorate, masked: false, maskedAt: null, address: { street: l.street, building: l.building ?? null, floor: l.floor ?? null, flat: l.flat ?? null, landmark: l.landmark ?? null } };
    }
};
exports.AddressService = AddressService;
exports.AddressService = AddressService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, patient_public_1.PatientService])
], AddressService);
//# sourceMappingURL=address.service.js.map