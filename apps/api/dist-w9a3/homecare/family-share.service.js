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
exports.FamilyShareService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const booking_public_1 = require("../booking/booking-public");
const engagement_public_1 = require("../engagement/engagement-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const messaging_public_1 = require("../messaging/messaging-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
const STATUS_TEXT = {
    CONFIRMED: { en: 'Confirmed', ar: 'مؤكدة' }, ASSIGNED: { en: 'A clinician was assigned', ar: 'تم تعيين مقدم الرعاية' }, EN_ROUTE: { en: 'On the way', ar: 'في الطريق' },
    ARRIVED: { en: 'Arrived', ar: 'وصل' }, FINISHED: { en: 'Finished', ar: 'انتهت' }, ABORTED_UNSAFE: { en: 'Visit stopped', ar: 'تم إيقاف الزيارة' },
};
const sha = (t) => (0, node_crypto_1.createHash)('sha256').update(t).digest('hex');
const maskPhone = (p) => (p.length > 6 ? `${p.slice(0, 4)}****${p.slice(-3)}` : '***');
let FamilyShareService = class FamilyShareService {
    prisma;
    booking;
    patients;
    hub;
    flags;
    log = new common_1.Logger('family-share');
    constructor(prisma, booking, patients, hub, flags) {
        this.prisma = prisma;
        this.booking = booking;
        this.patients = patients;
        this.hub = hub;
        this.flags = flags;
    }
    onModuleInit() {
        this.booking.onHomeStatus((b, kind) => this.onStatus(b, kind));
        this.patients.registerAnonymizer('familyShares', async (sub) => { await this.prisma.familyShare.updateMany({ where: { sub }, data: { phoneEnc: '', contactName: 'deleted', status: 'REVOKED' } }); });
    }
    present(s) { return { id: s.id, bookingId: s.bookingId, contactName: s.contactName, phoneMasked: s.phoneMasked, status: s.status, locale: s.locale, createdAt: s.createdAt }; }
    async create(sub, bookingId, i) {
        const b = await this.booking.ownedBooking(sub, bookingId);
        if (b.serviceLocation !== 'HOME')
            throw (0, errors_1.conflict)('NOT_A_HOME_BOOKING', 'Only home visits can be shared');
        await this.flags.assertEnabled('kiorex.home_visits', { market: 'EG' });
        if (['COMPLETED', 'CANCELLED', 'NO_SHOW', 'EXPIRED'].includes(b.status))
            throw (0, errors_1.conflict)('BOOKING_NOT_SHAREABLE', `Booking is ${b.status}`);
        if (!i.consentAttested)
            throw (0, errors_1.badRequest)('CONTACT_CONSENT_REQUIRED', 'Confirm that this person agreed to receive the visit status');
        if (i.visitStatusSharingConsent)
            await this.patients.setConsent(sub, 'VISIT_STATUS_SHARING', true, 'family-share');
        if (!(await this.patients.hasConsent(sub, 'VISIT_STATUS_SHARING')))
            throw (0, errors_1.badRequest)('CONSENT_REQUIRED', 'Grant the VISIT_STATUS_SHARING consent first', { purpose: 'VISIT_STATUS_SHARING' });
        const phone = i.phone.replace(/[\s-]/g, '');
        if (!/^\+?\d{9,15}$/.test(phone))
            throw (0, errors_1.badRequest)('INVALID_PHONE', 'phone must be an international number');
        const active = await this.prisma.familyShare.findMany({ where: { bookingId, status: 'ACTIVE' } });
        if (active.length >= (0, config_1.cfg)().familyShareMax)
            throw (0, errors_1.conflict)('FAMILY_SHARE_LIMIT', `At most ${(0, config_1.cfg)().familyShareMax} family contacts per visit`);
        const phoneHash = (0, crypto_1.blindIndex)(phone);
        if (active.some((a) => a.phoneHash === phoneHash))
            throw (0, errors_1.conflict)('FAMILY_CONTACT_EXISTS', 'This contact already follows the visit');
        const token = (0, node_crypto_1.randomBytes)(24).toString('base64url');
        const locale = i.locale === 'en' ? 'en' : 'ar';
        const row = await this.prisma.familyShare.upsert({
            where: { bookingId_phoneHash: { bookingId, phoneHash } },
            create: { id: (0, ids_1.newId)('kx_fs'), bookingId, sub, contactName: i.contactName.trim(), phoneEnc: (0, crypto_1.encryptField)(phone), phoneMasked: maskPhone(phone), phoneHash, tokenHash: sha(token), consentAttestedAt: new Date(), locale },
            update: { status: 'ACTIVE', stoppedAt: null, tokenHash: sha(token), contactName: i.contactName.trim(), phoneEnc: (0, crypto_1.encryptField)(phone), phoneMasked: maskPhone(phone), consentAttestedAt: new Date(), locale },
        });
        const link = `${(0, config_1.cfg)().appLinkBase.replace(/\/$/, '')}/visit-status/${token}`;
        const profile = await this.patients.profileBySub(sub);
        await this.send(row, phone, 'HOME_VISIT_FAMILY_INVITE', { patient: (profile?.nameEn ?? '').split(' ')[0], link }, sub);
        return { ...this.present(row), link };
    }
    async list(sub, bookingId) {
        await this.booking.ownedBooking(sub, bookingId);
        return (await this.prisma.familyShare.findMany({ where: { bookingId }, orderBy: { createdAt: 'asc' } })).map((s) => this.present(s));
    }
    async revoke(sub, bookingId, id) {
        await this.booking.ownedBooking(sub, bookingId);
        const r = await this.prisma.familyShare.updateMany({ where: { id, bookingId, status: 'ACTIVE' }, data: { status: 'REVOKED', stoppedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.notFound)('SHARE_NOT_FOUND', 'Share not found');
        return { ok: true };
    }
    async activeCount(bookingId) { return this.prisma.familyShare.count({ where: { bookingId, status: 'ACTIVE' } }); }
    async publicStatus(token) {
        const s = await this.prisma.familyShare.findUnique({ where: { tokenHash: sha(token) } });
        if (!s || s.status !== 'ACTIVE')
            throw (0, errors_1.notFound)('LINK_NOT_FOUND', 'This link is no longer active');
        const b = await this.booking.byId(s.bookingId);
        if (!b)
            throw (0, errors_1.notFound)('LINK_NOT_FOUND', 'This link is no longer active');
        if (b.terminalAt && b.terminalAt.getTime() + (0, config_1.cfg)().addressMaskHours * 3600_000 < Date.now())
            throw (0, errors_1.notFound)('LINK_NOT_FOUND', 'This link is no longer active');
        const prog = await this.booking.homeProgress(b);
        const profile = await this.patients.profileBySub(b.sub);
        return {
            patientFirstName: (profile?.nameEn ?? '').split(' ')[0] || null, startsAt: b.startsAt, status: b.status, subState: prog.subState, steps: prog.steps, eta: prog.eta,
            provider: prog.assignee ? { displayName: prog.assignee.displayName, badge: prog.assignee.badge } : null, stopped: prog.aborted,
        };
    }
    async stop(token) {
        const r = await this.prisma.familyShare.updateMany({ where: { tokenHash: sha(token), status: 'ACTIVE' }, data: { status: 'STOPPED', stoppedAt: new Date() } });
        if (!r.count)
            throw (0, errors_1.notFound)('LINK_NOT_FOUND', 'This link is no longer active');
        return { ok: true };
    }
    async send(s, phone, kind, params, sub) {
        const t = engagement_public_1.TEMPLATES[kind];
        return this.hub.send({ channel: 'WHATSAPP', sub, to: phone, templateId: t.templateId, locale: s.locale, body: (0, engagement_public_1.render)(s.locale === 'en' ? t.en : t.ar, params) });
    }
    async onStatus(b, kind) {
        const shares = await this.prisma.familyShare.findMany({ where: { bookingId: b.id, status: 'ACTIVE' } });
        if (!shares.length)
            return;
        if (!(await this.patients.hasConsent(b.sub, 'VISIT_STATUS_SHARING'))) {
            await this.prisma.familyShare.updateMany({ where: { bookingId: b.id, status: 'ACTIVE' }, data: { status: 'STOPPED', stoppedAt: new Date() } });
            return;
        }
        if (kind === 'EN_ROUTE' && !(await this.flags.isEnabled('kiorex.visit_tracking', { market: 'EG' })))
            return;
        const profile = await this.patients.profileBySub(b.sub);
        for (const s of shares) {
            if (s.lastNotifiedState === kind)
                continue;
            await this.prisma.familyShare.update({ where: { id: s.id }, data: { lastNotifiedState: kind } });
            const text = STATUS_TEXT[kind];
            try {
                await this.send(s, (0, crypto_1.decryptField)(s.phoneEnc), 'HOME_VISIT_FAMILY_UPDATE', { patient: (profile?.nameEn ?? '').split(' ')[0], status: s.locale === 'en' ? text.en : text.ar, link: '' }, b.sub);
            }
            catch (e) {
                this.log.warn(`family update failed for share ${s.id}`);
            }
        }
    }
};
exports.FamilyShareService = FamilyShareService;
exports.FamilyShareService = FamilyShareService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, booking_public_1.BookingService, patient_public_1.PatientService, messaging_public_1.MessagingHub, control_plane_public_1.FlagsService])
], FamilyShareService);
//# sourceMappingURL=family-share.service.js.map