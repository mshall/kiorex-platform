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
exports.ClinicStaffPhoneMatch = exports.MockStaffPhoneMatch = exports.STAFF_PHONE_MATCH = exports.ReferralIdentityService = void 0;
exports.staffPhoneMatchHash = staffPhoneMatchHash;
const node_crypto_1 = require("node:crypto");
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const kiorly_public_1 = require("../../kiorly/kiorly-public");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
let ReferralIdentityService = class ReferralIdentityService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async record(sub, kind, valueHash) {
        if (!valueHash)
            return;
        await this.prisma.referralIdentitySignal.createMany({ data: [{ sub, kind, valueHash }], skipDuplicates: true });
    }
    async recordPhone(sub, phone) {
        if (!phone)
            return;
        await this.record(sub, 'PHONE', (0, privacy_hash_1.addressHash)(phone));
        const secret = (0, config_1.cfg)().kiorlyClientSecret;
        if (secret)
            await this.record(sub, 'STAFF_MATCH', staffPhoneMatchHash(phone, secret));
    }
    async hashesOf(sub, kind) { return (await this.prisma.referralIdentitySignal.findMany({ where: { sub, kind }, select: { valueHash: true } })).map((r) => r.valueHash); }
    async seenOnOtherSub(kind, valueHash, sub) { return !!(await this.prisma.referralIdentitySignal.findFirst({ where: { kind, valueHash, sub: { not: sub } }, select: { id: true } })); }
    async shared(kindOf, a, b) {
        const [x, y] = await Promise.all([this.hashesOf(a, kindOf), this.hashesOf(b, kindOf)]);
        return x.some((h) => y.includes(h));
    }
    async distinctSubsSince(kind, valueHash, since) {
        return (await this.prisma.referralIdentitySignal.findMany({ where: { kind, valueHash, firstSeenAt: { gte: since } }, select: { sub: true }, distinct: ['sub'] })).length;
    }
};
exports.ReferralIdentityService = ReferralIdentityService;
exports.ReferralIdentityService = ReferralIdentityService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], ReferralIdentityService);
function staffPhoneMatchHash(phone, clientSecret) {
    const d = phone.replace(/\D+/g, '');
    const key = (0, node_crypto_1.createHmac)('sha256', clientSecret).update('kx-staff-phone-match-v1').digest();
    return (0, node_crypto_1.createHmac)('sha256', key).update(d.length > 10 ? d.slice(-10) : d).digest('base64url');
}
exports.STAFF_PHONE_MATCH = 'GROWTH_STAFF_PHONE_MATCH';
let MockStaffPhoneMatch = class MockStaffPhoneMatch {
    staff = new Map();
    async matches(providerClinicId, phoneHashes) { const s = this.staff.get(providerClinicId); return !!s && phoneHashes.some((h) => s.has(h)); }
};
exports.MockStaffPhoneMatch = MockStaffPhoneMatch;
exports.MockStaffPhoneMatch = MockStaffPhoneMatch = __decorate([
    (0, common_1.Injectable)()
], MockStaffPhoneMatch);
let ClinicStaffPhoneMatch = class ClinicStaffPhoneMatch {
    kiorly;
    log = new common_1.Logger('staff-phone-match');
    constructor(kiorly) {
        this.kiorly = kiorly;
    }
    async matches(providerClinicId, phoneHashes) {
        const hashes = [...new Set(phoneHashes)].slice(0, 20);
        if (!this.kiorly || !hashes.length)
            return false;
        try {
            return (await this.kiorly.staffPhoneMatch(providerClinicId, hashes)).data.match === true;
        }
        catch (e) {
            this.log.debug(`staff phone match unavailable (${e.message}); answering no match`);
            return false;
        }
    }
};
exports.ClinicStaffPhoneMatch = ClinicStaffPhoneMatch;
exports.ClinicStaffPhoneMatch = ClinicStaffPhoneMatch = __decorate([
    (0, common_1.Injectable)(),
    __param(0, (0, common_1.Optional)()),
    __param(0, (0, common_1.Inject)(kiorly_public_1.KiorlyClient)),
    __metadata("design:paramtypes", [kiorly_public_1.KiorlyClient])
], ClinicStaffPhoneMatch);
//# sourceMappingURL=referral-identity.service.js.map