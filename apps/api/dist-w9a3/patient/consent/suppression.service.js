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
exports.SuppressionService = exports.SUPPRESSION_REASONS = exports.SUPPRESSION_CHANNELS = void 0;
const common_1 = require("@nestjs/common");
const privacy_hash_1 = require("../../common/privacy-hash");
const prisma_service_1 = require("../../prisma/prisma.service");
exports.SUPPRESSION_CHANNELS = ['WHATSAPP', 'SMS', 'EMAIL', 'PUSH', 'ALL'];
exports.SUPPRESSION_REASONS = ['STOP', 'BOUNCE', 'COMPLAINT', 'WITHDRAWAL', 'MANUAL'];
let SuppressionService = class SuppressionService {
    prisma;
    constructor(prisma) {
        this.prisma = prisma;
    }
    async add(i) {
        const channel = exports.SUPPRESSION_CHANNELS.includes(i.channel ?? '') ? i.channel : 'ALL';
        const reason = exports.SUPPRESSION_REASONS.includes(i.reason ?? '') ? i.reason : 'MANUAL';
        const h = (0, privacy_hash_1.addressHash)(i.address);
        const market = i.market ?? 'EG';
        return this.prisma.communicationSuppression.upsert({
            where: { market_channel_addressHash: { market, channel, addressHash: h } },
            create: { market, channel, addressHash: h, reason, source: i.source ?? 'system' },
            update: { liftedAt: null, reason, source: i.source ?? 'system' },
        });
    }
    async lift(address, channel = 'ALL', market = 'EG') {
        const r = await this.prisma.communicationSuppression.updateMany({ where: { market, channel, addressHash: (0, privacy_hash_1.addressHash)(address), liftedAt: null }, data: { liftedAt: new Date() } });
        return r.count > 0;
    }
    async liftOwnOptOut(addresses, channel, market = 'EG') {
        const hashes = addresses.filter((a) => !!a).map(privacy_hash_1.addressHash);
        if (!hashes.length)
            return 0;
        const r = await this.prisma.communicationSuppression.updateMany({ where: { market, channel, addressHash: { in: hashes }, reason: { in: ['STOP', 'WITHDRAWAL'] }, liftedAt: null }, data: { liftedAt: new Date() } });
        return r.count;
    }
    async isHashSuppressed(hashes, channel, market = 'EG') {
        if (!hashes.length)
            return false;
        return (await this.prisma.communicationSuppression.count({ where: { market, addressHash: { in: hashes }, channel: { in: [channel, 'ALL'] }, liftedAt: null } })) > 0;
    }
    async isSuppressed(addresses, channel, market = 'EG') {
        const hashes = addresses.filter((a) => !!a).map(privacy_hash_1.addressHash);
        if (!hashes.length)
            return false;
        return (await this.prisma.communicationSuppression.count({ where: { market, addressHash: { in: hashes }, channel: { in: [channel, 'ALL'] }, liftedAt: null } })) > 0;
    }
};
exports.SuppressionService = SuppressionService;
exports.SuppressionService = SuppressionService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService])
], SuppressionService);
//# sourceMappingURL=suppression.service.js.map