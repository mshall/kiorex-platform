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
exports.WhatsAppBookingService = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ai_gateway_public_1 = require("../ai-gateway/ai-gateway-public");
const booking_public_1 = require("../booking/booking-public");
const catalog_public_1 = require("../catalog/catalog-public");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const market_public_1 = require("../market/market-public");
const messaging_public_1 = require("../messaging/messaging-public");
const patient_public_1 = require("../patient/patient-public");
const growth_ports_public_1 = require("../growth/growth-ports-public");
const prisma_service_1 = require("../prisma/prisma.service");
const safety_public_1 = require("../safety/safety-public");
const waitlist_public_1 = require("../waitlist/waitlist-public");
const whatsapp_copy_1 = require("./whatsapp-copy");
const SHOWN_SPECIALTIES = safety_public_1.SPECIALTY_CODES.slice(0, 6);
const YES = new Set(['yes', 'y', 'ok', 'confirm', 'نعم', 'ايوه', 'ايوا', 'تمام', 'اكد', 'تأكيد', 'تاكيد', '1']);
const NO = new Set(['no', 'n', 'لا', 'مش عايز']);
const CANCEL = new Set(['0', 'cancel', 'reset', 'menu', 'الغاء', 'إلغاء', 'قائمه', 'قائمة']);
const STOP = new Set(['stop', 'unsubscribe', 'وقف', 'ايقاف', 'إيقاف', 'الغاء الاشتراك', 'ايقاف الرسائل', 'وقف الرسائل']);
const norm = (s) => (0, safety_public_1.normalizeText)(s ?? '').replace(/[.!؟?,،]/g, '').trim();
let WhatsAppBookingService = class WhatsAppBookingService {
    prisma;
    hub;
    flags;
    patients;
    catalog;
    booking;
    waitlist;
    markets;
    suppression;
    growthFacts;
    assistant;
    constructor(prisma, hub, flags, patients, catalog, booking, waitlist, markets, suppression, growthFacts, assistant) {
        this.prisma = prisma;
        this.hub = hub;
        this.flags = flags;
        this.patients = patients;
        this.catalog = catalog;
        this.booking = booking;
        this.waitlist = waitlist;
        this.markets = markets;
        this.suppression = suppression;
        this.growthFacts = growthFacts;
        this.assistant = assistant;
    }
    onModuleInit() { this.hub.onInbound('WHATSAPP', (m) => this.handle(m)); }
    async reply(c, id, body, sub) {
        await this.hub.send({ channel: 'WHATSAPP', sub: sub ?? c.sub ?? undefined, to: c.phone, templateId: (0, whatsapp_copy_1.T)(id), locale: c.locale, body });
    }
    async save(c, state, ctx) {
        return this.prisma.channelConversation.update({ where: { id: c.id }, data: { state, context: ctx } });
    }
    async handle(m) {
        const phone = m.from;
        const text = norm(m.buttonPayload ?? m.text);
        const now = new Date();
        const known = await this.prisma.channelConversation.findUnique({ where: { channel_phone: { channel: 'WHATSAPP', phone } }, select: { id: true } });
        let conv = await this.prisma.channelConversation.upsert({ where: { channel_phone: { channel: 'WHATSAPP', phone } }, create: { phone, lastInboundAt: now, locale: /[؀-ۿ]/.test(m.text ?? '') ? 'ar' : 'en' }, update: {} });
        if (!known)
            await this.growthFacts?.recordFact({ name: 'WhatsAppConversationStarted', naturalKey: conv.id, props: { platform: 'whatsapp' } }).catch(() => undefined);
        const profile = await this.prisma.patientProfile.findFirst({ where: { phone, deletedAt: null } });
        const lang = profile ? (profile.preferredLocale === 'en' ? 'en' : 'ar') : /[؀-ۿ]/.test(m.text ?? '') ? 'ar' : conv.locale;
        conv = await this.prisma.channelConversation.update({ where: { id: conv.id }, data: { lastInboundAt: now, locale: lang, sub: profile?.sub ?? null } });
        let state = conv.state;
        let ctx = (conv.context ?? {});
        if (state !== 'IDLE' && conv.expiresAt && conv.expiresAt < now) {
            await this.releaseHeld(conv.sub, ctx);
            state = 'IDLE';
            ctx = {};
        }
        conv = await this.prisma.channelConversation.update({ where: { id: conv.id }, data: { expiresAt: new Date(now.getTime() + (0, config_1.cfg)().whatsappSessionMinutes * 60_000) } });
        if (this.assistant) {
            const market0 = profile?.market ?? 'EG';
            if ((await this.assistant.route({ phone, text: m.text, buttonPayload: m.buttonPayload, logId: m.logId, providerRef: m.providerRef }, { id: conv.id, phone, locale: conv.locale, sub: conv.sub, state }, profile ? { sub: profile.sub, market: market0, preferredLocale: profile.preferredLocale } : null)) === 'HANDLED')
                return;
        }
        const em = (0, safety_public_1.detectEmergency)(m.text);
        if (em.emergency) {
            await this.releaseHeld(conv.sub, ctx);
            await this.save(conv, 'IDLE', {});
            await this.catalog.track('emergency_guidance_shown', { code: em.categories[0] });
            return this.reply(conv, 'emergency', whatsapp_copy_1.copy.emergency(lang));
        }
        if (STOP.has(text)) {
            await this.suppression.add({ address: phone, channel: 'WHATSAPP', reason: 'STOP', source: 'whatsapp-inbound', market: profile?.market ?? 'EG' });
            if (profile) {
                await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub: profile.sub, channel: 'WHATSAPP' } }, create: { sub: profile.sub, channel: 'WHATSAPP', enabled: false }, update: { enabled: false } });
                if (await this.patients.hasConsent(profile.sub, 'MARKETING_WHATSAPP'))
                    await this.patients.setConsent(profile.sub, 'MARKETING_WHATSAPP', false, { source: 'whatsapp', evidence: 'stop_keyword' });
            }
            await this.releaseHeld(conv.sub, ctx);
            await this.save(conv, 'IDLE', {});
            return this.reply(conv, 'stopped', whatsapp_copy_1.copy.stopped(lang));
        }
        const market = profile?.market ?? 'EG';
        if (!(await this.flags.isEnabled('kiorex.whatsapp_booking', { market })) || !(await this.marketLive(market)))
            return this.reply(conv, 'app_link', whatsapp_copy_1.copy.appLink(lang));
        if (!profile)
            return this.reply(conv, 'not_registered', whatsapp_copy_1.copy.notRegistered(lang));
        if (CANCEL.has(text)) {
            await this.releaseHeld(profile.sub, ctx);
            await this.save(conv, 'IDLE', {});
            return this.reply(conv, 'cancelled', whatsapp_copy_1.copy.cancelled(lang), profile.sub);
        }
        try {
            switch (state) {
                case 'IDLE': return await this.start(conv, profile.sub, lang, m.text ?? '');
                case 'CHOOSE_SPECIALTY': return await this.onSpecialty(conv, profile.sub, lang, ctx, text, m.text ?? '');
                case 'CHOOSE_DOCTOR': return await this.onDoctor(conv, profile.sub, lang, ctx, text);
                case 'CHOOSE_SLOT': return await this.onSlot(conv, profile.sub, lang, ctx, text);
                case 'OFFER_WAITLIST': return await this.onWaitlist(conv, profile.sub, lang, ctx, text);
                case 'CONFIRM': return await this.onConfirm(conv, profile.sub, lang, ctx, text);
            }
        }
        catch (e) {
            return this.fail(conv, profile.sub, lang, ctx, e);
        }
    }
    async marketLive(market) { try {
        await this.markets.assertLive(market);
        return true;
    }
    catch {
        return false;
    } }
    async releaseHeld(sub, ctx) {
        if (sub && ctx.bookingId)
            await this.booking.release(sub, ctx.bookingId).catch(() => undefined);
    }
    async start(c, sub, lang, raw) {
        const mapped = (0, safety_public_1.mapSymptomToSpecialties)(raw);
        if (mapped.length)
            return this.showDoctors(c, sub, lang, {}, mapped[0]);
        await this.save(c, 'CHOOSE_SPECIALTY', { specialties: SHOWN_SPECIALTIES });
        return this.reply(c, 'choose_specialty', whatsapp_copy_1.copy.chooseSpecialty(lang, SHOWN_SPECIALTIES), sub);
    }
    async onSpecialty(c, sub, lang, ctx, text, raw) {
        const idx = /^\d+$/.test(text) ? Number(text) - 1 : -1;
        const code = idx >= 0 ? ctx.specialties?.[idx] : (0, safety_public_1.mapSymptomToSpecialties)(raw)[0];
        if (!code)
            return this.reply(c, 'invalid', whatsapp_copy_1.copy.invalid(lang), sub);
        return this.showDoctors(c, sub, lang, ctx, code);
    }
    async showDoctors(c, sub, lang, ctx, specialty) {
        const res = await this.catalog.search({ specialty, sort: 'earliest', pageSize: 3 });
        const items = (res.items ?? []).filter((i) => i.bookable && i.defaultTypeId).slice(0, 3);
        if (!items.length) {
            await this.save(c, 'CHOOSE_SPECIALTY', { specialties: ctx.specialties ?? SHOWN_SPECIALTIES });
            return this.reply(c, 'no_doctors', whatsapp_copy_1.copy.noDoctors(lang), sub);
        }
        const doctors = items.map((i) => ({ id: i.id, typeId: i.defaultTypeId, name: (lang === 'ar' ? i.nameAr : i.nameEn) ?? i.nameEn ?? i.nameAr, fee: i.minFeeMinor, currency: i.currency }));
        await this.save(c, 'CHOOSE_DOCTOR', { doctors: doctors.map(({ id, typeId, name }) => ({ id, typeId, name })) });
        return this.reply(c, 'choose_doctor', whatsapp_copy_1.copy.chooseDoctor(lang, doctors), sub);
    }
    async onDoctor(c, sub, lang, ctx, text) {
        const d = /^\d+$/.test(text) ? ctx.doctors?.[Number(text) - 1] : undefined;
        if (!d)
            return this.reply(c, 'invalid', whatsapp_copy_1.copy.invalid(lang), sub);
        return this.showSlots(c, sub, lang, { providerId: d.id, typeId: d.typeId, doctor: d.name });
    }
    async showSlots(c, sub, lang, ctx, slotsOverride) {
        const row = await this.catalog.getRow(ctx.providerId);
        const now = new Date();
        const slots = (slotsOverride?.length ? slotsOverride : await this.catalog.slots(row, ctx.typeId, now, new Date(now.getTime() + 7 * 86400_000))).slice(0, 5);
        if (!slots.length) {
            await this.save(c, 'OFFER_WAITLIST', ctx);
            return this.reply(c, 'no_slots', whatsapp_copy_1.copy.noSlots(lang), sub);
        }
        await this.save(c, 'CHOOSE_SLOT', { ...ctx, slots });
        return this.reply(c, 'choose_slot', whatsapp_copy_1.copy.chooseSlot(lang, slots), sub);
    }
    async onWaitlist(c, sub, lang, ctx, text) {
        if (!YES.has(text))
            return this.reply(c, 'invalid', whatsapp_copy_1.copy.invalid(lang), sub);
        await this.waitlist.join(sub, { providerId: ctx.providerId, typeId: ctx.typeId });
        await this.save(c, 'IDLE', {});
        return this.reply(c, 'waitlisted', whatsapp_copy_1.copy.waitlisted(lang), sub);
    }
    async onSlot(c, sub, lang, ctx, text) {
        const s = /^\d+$/.test(text) ? ctx.slots?.[Number(text) - 1] : undefined;
        if (!s)
            return this.reply(c, 'invalid', whatsapp_copy_1.copy.invalid(lang), sub);
        const b = await this.booking.createIntent(sub, { providerId: ctx.providerId, typeId: ctx.typeId, startsAt: s.startsAt, endsAt: s.endsAt, channel: 'WHATSAPP' });
        await this.save(c, 'CONFIRM', { ...ctx, bookingId: b.id, startsAt: s.startsAt });
        return this.reply(c, 'held_confirm', whatsapp_copy_1.copy.heldConfirm(lang, ctx.doctor ?? '', s.startsAt), sub);
    }
    async onConfirm(c, sub, lang, ctx, text) {
        if (NO.has(text)) {
            await this.releaseHeld(sub, ctx);
            await this.save(c, 'IDLE', {});
            return this.reply(c, 'cancelled', whatsapp_copy_1.copy.cancelled(lang), sub);
        }
        if (!YES.has(text))
            return this.reply(c, 'invalid', whatsapp_copy_1.copy.invalid(lang), sub);
        const b = await this.booking.confirm(sub, ctx.bookingId, { marketplaceConsent: true });
        await this.save(c, 'IDLE', {});
        await this.reply(c, 'confirmed', whatsapp_copy_1.copy.confirmed(lang, ctx.doctor ?? '', ctx.startsAt ?? b.startsAt.toString(), b.status === 'PENDING_CLINIC'), sub);
        if (b.depositStatus === 'REQUIRED' && (await this.flags.isEnabled('kiorex.pay_deposits', { market: 'EG' }))) {
            const d = await this.booking.depositCheckout(sub, b.id);
            await this.reply(c, 'deposit', whatsapp_copy_1.copy.deposit(lang, d.checkoutUrl ?? ''), sub);
        }
    }
    async fail(c, sub, lang, ctx, e) {
        const body = e instanceof errors_1.ApiError ? e.getResponse() : {};
        const code = body.code;
        const alts = (body.alternatives ?? []);
        if ((code === 'SLOT_TAKEN' || code === 'HOLD_EXPIRED') && ctx.providerId) {
            await this.reply(c, 'slot_taken', code === 'HOLD_EXPIRED' ? whatsapp_copy_1.copy.holdExpired(lang) : whatsapp_copy_1.copy.slotTaken(lang), sub);
            if (alts.length) {
                await this.save(c, 'CHOOSE_SLOT', { ...ctx, bookingId: undefined, slots: alts.slice(0, 3) });
                return this.reply(c, 'choose_slot', whatsapp_copy_1.copy.chooseSlot(lang, alts.slice(0, 3)), sub);
            }
            return this.showSlots(c, sub, lang, { ...ctx, bookingId: undefined });
        }
        if (code === 'CLINIC_SYSTEM_BUSY')
            return this.reply(c, 'busy', whatsapp_copy_1.copy.busy(lang), sub);
        await this.releaseHeld(sub, ctx);
        await this.save(c, 'IDLE', {});
        return this.reply(c, 'generic', whatsapp_copy_1.copy.generic(lang), sub);
    }
    conversation(phone) { return this.prisma.channelConversation.findUnique({ where: { channel_phone: { channel: 'WHATSAPP', phone } } }); }
};
exports.WhatsAppBookingService = WhatsAppBookingService;
exports.WhatsAppBookingService = WhatsAppBookingService = __decorate([
    (0, common_1.Injectable)(),
    __param(9, (0, common_1.Optional)()),
    __param(9, (0, common_1.Inject)(growth_ports_public_1.GROWTH_FACTS)),
    __param(10, (0, common_1.Optional)()),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, messaging_public_1.MessagingHub, control_plane_public_1.FlagsService, patient_public_1.PatientService, catalog_public_1.CatalogService,
        booking_public_1.BookingService, waitlist_public_1.WaitlistService, market_public_1.MarketService, patient_public_1.SuppressionService, Object, ai_gateway_public_1.AssistantRouter])
], WhatsAppBookingService);
//# sourceMappingURL=whatsapp-booking.service.js.map