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
exports.ConsentService = exports.CONSENT_TEXT_PLACEHOLDER = exports.CONSENT_SOURCES = exports.ALL_CONSENT_PURPOSES = exports.GROWTH_CONSENT_PURPOSES = exports.MARKETING_CONSENT_PURPOSES = exports.CORE_CONSENT_PURPOSES = void 0;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const privacy_hash_1 = require("../../common/privacy-hash");
const outbox_public_1 = require("../../outbox/outbox-public");
const prisma_service_1 = require("../../prisma/prisma.service");
exports.CORE_CONSENT_PURPOSES = ['MARKETPLACE_PROCESSING', 'REMINDERS', 'RECORD_SHARING', 'AI_PROCESSING', 'VISIT_STATUS_SHARING'];
exports.MARKETING_CONSENT_PURPOSES = ['MARKETING_WHATSAPP', 'MARKETING_SMS', 'MARKETING_EMAIL', 'MARKETING_PUSH'];
exports.GROWTH_CONSENT_PURPOSES = ['ANALYTICS_MEASUREMENT', ...exports.MARKETING_CONSENT_PURPOSES];
exports.ALL_CONSENT_PURPOSES = [...exports.CORE_CONSENT_PURPOSES, ...exports.GROWTH_CONSENT_PURPOSES];
exports.CONSENT_SOURCES = ['web', 'app', 'whatsapp', 'widget', 'ops-import'];
exports.CONSENT_TEXT_PLACEHOLDER = 'TODO_NEEDS_HUMAN_v0';
let ConsentService = class ConsentService {
    prisma;
    outbox;
    textVersions = async () => null;
    constructor(prisma, outbox) {
        this.prisma = prisma;
        this.outbox = outbox;
    }
    setTextVersionProvider(fn) { this.textVersions = fn; }
    channelOf(purpose) { return exports.MARKETING_CONSENT_PURPOSES.includes(purpose) ? purpose.slice('MARKETING_'.length) : null; }
    async textVersionFor(purpose, market = 'EG') {
        const v = await this.textVersions(market).catch(() => null);
        if (!v)
            return exports.CONSENT_TEXT_PLACEHOLDER;
        return purpose === 'ANALYTICS_MEASUREMENT' ? v.analytics : exports.MARKETING_CONSENT_PURPOSES.includes(purpose) ? v.marketing : exports.CONSENT_TEXT_PLACEHOLDER;
    }
    async setConsent(sub, purpose, granted, o = {}) {
        if (!exports.ALL_CONSENT_PURPOSES.includes(purpose))
            throw (0, errors_1.badRequest)('UNKNOWN_CONSENT_PURPOSE', 'Unknown consent purpose', { allowed: exports.ALL_CONSENT_PURPOSES });
        const source = (o.source ?? 'app').slice(0, 32);
        const eventSource = exports.CONSENT_SOURCES.includes(source) ? source : 'app';
        const textVersion = (o.textVersion && o.textVersion.length <= 64 ? o.textVersion : null) ?? (await this.textVersionFor(purpose));
        const at = new Date();
        await this.prisma.$transaction(async (tx) => {
            const channel = this.channelOf(purpose);
            await tx.consentRecord.create({ data: { sub, purpose, granted, version: textVersion, source, channel, ipHash: o.ip ? (0, privacy_hash_1.ipHashOf)(o.ip, at) : null, evidence: o.evidence?.slice(0, 64) } });
            await this.outbox.enqueue(tx, {
                type: 'PatientConsentUpdated', aggregateType: 'PatientConsent', aggregateId: (0, privacy_hash_1.subRefOf)(sub),
                payload: { subRef: (0, privacy_hash_1.subRefOf)(sub), purpose, ...(channel ? { channel } : {}), granted, textVersion, source: eventSource, at: at.toISOString() },
            });
        });
        return { purpose, granted };
    }
    async hasConsent(sub, purpose) {
        const last = await this.prisma.consentRecord.findFirst({ where: { sub, purpose }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        return !!last?.granted;
    }
    async states(sub, purposes) {
        const rows = await this.prisma.consentRecord.findMany({ where: { sub, purpose: { in: [...purposes] } }, orderBy: [{ createdAt: 'desc' }, { id: 'desc' }] });
        const out = new Map();
        for (const p of purposes) {
            const r = rows.find((x) => x.purpose === p);
            out.set(p, { granted: !!r?.granted, version: r?.version ?? null, updatedAt: r?.createdAt ?? null });
        }
        return out;
    }
    hasMarketingConsent(sub, channel) { return this.hasConsent(sub, `MARKETING_${channel === 'INAPP' ? 'PUSH' : channel}`); }
    history(sub, take = 200) { return this.prisma.consentRecord.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take }); }
};
exports.ConsentService = ConsentService;
exports.ConsentService = ConsentService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, outbox_public_1.OutboxService])
], ConsentService);
//# sourceMappingURL=consent.service.js.map