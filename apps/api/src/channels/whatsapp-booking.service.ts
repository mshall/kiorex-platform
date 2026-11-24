import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { ChannelConversation } from '../prisma/generated/client';
import { cfg } from '../common/config';
import { ApiError } from '../common/errors';
import { AssistantRouter } from '../ai-gateway/ai-gateway-public';
import { BookingService } from '../booking/booking-public';
import { CatalogService } from '../catalog/catalog-public';
import { FlagsService } from '../control-plane/control-plane-public';
import { MarketService } from '../market/market-public';
import { InboundMessage, MessagingHub } from '../messaging/messaging-public';
import { PatientService, SuppressionService } from '../patient/patient-public';
import { GROWTH_FACTS, type GrowthFactsPort } from '../growth/growth-ports-public';
import { PrismaService } from '../prisma/prisma.service';
import { detectEmergency, mapSymptomToSpecialties, normalizeText, SPECIALTY_CODES, SpecialtyCode } from '../safety/safety-public';
import { WaitlistService } from '../waitlist/waitlist-public';
import { copy, Lang, T } from './whatsapp-copy';

type State = 'IDLE' | 'CHOOSE_SPECIALTY' | 'CHOOSE_DOCTOR' | 'CHOOSE_SLOT' | 'OFFER_WAITLIST' | 'CONFIRM';
interface Ctx {
  specialties?: SpecialtyCode[];
  doctors?: { id: string; typeId: string; name: string }[];
  providerId?: string; typeId?: string; doctor?: string;
  slots?: { startsAt: string; endsAt: string }[];
  bookingId?: string; startsAt?: string;
}
const SHOWN_SPECIALTIES: SpecialtyCode[] = SPECIALTY_CODES.slice(0, 6) as unknown as SpecialtyCode[];
const YES = new Set(['yes', 'y', 'ok', 'confirm', 'نعم', 'ايوه', 'ايوا', 'تمام', 'اكد', 'تأكيد', 'تاكيد', '1']);
const NO = new Set(['no', 'n', 'لا', 'مش عايز']);
const CANCEL = new Set(['0', 'cancel', 'reset', 'menu', 'الغاء', 'إلغاء', 'قائمه', 'قائمة']);
const STOP = new Set(['stop', 'unsubscribe', 'وقف', 'ايقاف', 'إيقاف', 'الغاء الاشتراك', 'ايقاف الرسائل', 'وقف الرسائل']); // normalised forms; a bare 'الغاء' keeps its old meaning (cancel the booking conversation)
const norm = (s?: string) => normalizeText(s ?? '').replace(/[.!؟?,،]/g, '').trim();

/**
 * KXM-BK-11 WhatsApp booking channel (KIOREX_WHATSAPP source). A conversation state machine over the messaging adapter; every
 * booking step goes through the SAME BookingService (holds, Idempotency-Key confirm, deposits) as the marketplace app.
 * MODE=mock: inbound arrives via POST /dev/messaging/inbound; replies land in the dev outbox. No real Meta calls.
 */
@Injectable()
export class WhatsAppBookingService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly hub: MessagingHub, private readonly flags: FlagsService, private readonly patients: PatientService, private readonly catalog: CatalogService,
    private readonly booking: BookingService, private readonly waitlist: WaitlistService, private readonly markets: MarketService, private readonly suppression: SuppressionService,
    @Optional() @Inject(GROWTH_FACTS) private readonly growthFacts?: GrowthFactsPort, @Optional() private readonly assistant?: AssistantRouter,
  ) {}

  onModuleInit() { this.hub.onInbound('WHATSAPP', (m) => this.handle(m)); }

  private async reply(c: ChannelConversation, id: string, body: string, sub?: string) {
    await this.hub.send({ channel: 'WHATSAPP', sub: sub ?? c.sub ?? undefined, to: c.phone, templateId: T(id), locale: c.locale, body });
  }
  private async save(c: ChannelConversation, state: State, ctx: Ctx) {
    return this.prisma.channelConversation.update({ where: { id: c.id }, data: { state, context: ctx as object } });
  }

  async handle(m: InboundMessage & { logId: string }) {
    const phone = m.from;
    const text = norm(m.buttonPayload ?? m.text);
    const now = new Date();
    const known = await this.prisma.channelConversation.findUnique({ where: { channel_phone: { channel: 'WHATSAPP', phone } }, select: { id: true } });
    let conv = await this.prisma.channelConversation.upsert({ where: { channel_phone: { channel: 'WHATSAPP', phone } }, create: { phone, lastInboundAt: now, locale: /[؀-ۿ]/.test(m.text ?? '') ? 'ar' : 'en' }, update: {} });
    if (!known) await this.growthFacts?.recordFact({ name: 'WhatsAppConversationStarted', naturalKey: conv.id, props: { platform: 'whatsapp' } }).catch(() => undefined); // GRW-P1-J: one per new conversation, no phone
    const profile = await this.prisma.patientProfile.findFirst({ where: { phone, deletedAt: null } });
    const lang: Lang = profile ? (profile.preferredLocale === 'en' ? 'en' : 'ar') : /[؀-ۿ]/.test(m.text ?? '') ? 'ar' : (conv.locale as Lang);
    conv = await this.prisma.channelConversation.update({ where: { id: conv.id }, data: { lastInboundAt: now, locale: lang, sub: profile?.sub ?? null } });
    // a stale session never resumes mid-flow: free the hold and start over
    let state = conv.state as State; let ctx = (conv.context ?? {}) as Ctx;
    if (state !== 'IDLE' && conv.expiresAt && conv.expiresAt < now) { await this.releaseHeld(conv.sub, ctx); state = 'IDLE'; ctx = {}; }
    conv = await this.prisma.channelConversation.update({ where: { id: conv.id }, data: { expiresAt: new Date(now.getTime() + cfg().whatsappSessionMinutes * 60_000) } });

    // 0) GRW-P2-D: the assistant front stage. It runs BEFORE the machine so its own holds are freed by the same safety step, but it answers only when the locked flag, consent, budgets and rate allow; STOP and every
    //    miss, model failure or error return DETERMINISTIC and the machine below answers exactly as before. Emergency language is checked again inside the assistant before any model call.
    if (this.assistant) {
      const market0 = profile?.market ?? 'EG';
      if ((await this.assistant.route({ phone, text: m.text, buttonPayload: m.buttonPayload, logId: m.logId, providerRef: m.providerRef }, { id: conv.id, phone, locale: conv.locale, sub: conv.sub, state }, profile ? { sub: profile.sub, market: market0, preferredLocale: profile.preferredLocale } : null)) === 'HANDLED') return;
    }
    // 1) SAFETY FIRST (never a flag): emergency language interrupts everything and blocks booking (KXM-DS-06)
    const em = detectEmergency(m.text);
    if (em.emergency) {
      await this.releaseHeld(conv.sub, ctx);
      await this.save(conv, 'IDLE', {});
      await this.catalog.track('emergency_guidance_shown', { code: em.categories[0] });
      return this.reply(conv, 'emergency', copy.emergency(lang));
    }
    // 1b) channel opt-out (STOP / إلغاء الاشتراك) works even when WhatsApp booking is switched OFF: it is a legal opt-out, never a feature (GRW-P1-I)
    if (STOP.has(text)) {
      await this.suppression.add({ address: phone, channel: 'WHATSAPP', reason: 'STOP', source: 'whatsapp-inbound', market: profile?.market ?? 'EG' });
      if (profile) {
        await this.prisma.notificationPreference.upsert({ where: { sub_channel: { sub: profile.sub, channel: 'WHATSAPP' } }, create: { sub: profile.sub, channel: 'WHATSAPP', enabled: false }, update: { enabled: false } });
        if (await this.patients.hasConsent(profile.sub, 'MARKETING_WHATSAPP')) await this.patients.setConsent(profile.sub, 'MARKETING_WHATSAPP', false, { source: 'whatsapp', evidence: 'stop_keyword' });
      }
      await this.releaseHeld(conv.sub, ctx); await this.save(conv, 'IDLE', {});
      return this.reply(conv, 'stopped', copy.stopped(lang));
    }
    // 2) flag OFF (kiorex.whatsapp_booking, market scope): reply with the app link only
    const market = profile?.market ?? 'EG';
    if (!(await this.flags.isEnabled('kiorex.whatsapp_booking', { market })) || !(await this.marketLive(market))) return this.reply(conv, 'app_link', copy.appLink(lang));
    // 4) identity: booking needs an existing Kiorex profile (consent + identity live in the app)
    if (!profile) return this.reply(conv, 'not_registered', copy.notRegistered(lang));
    if (CANCEL.has(text)) { await this.releaseHeld(profile.sub, ctx); await this.save(conv, 'IDLE', {}); return this.reply(conv, 'cancelled', copy.cancelled(lang), profile.sub); }

    try {
      switch (state) {
        case 'IDLE': return await this.start(conv, profile.sub, lang, m.text ?? '');
        case 'CHOOSE_SPECIALTY': return await this.onSpecialty(conv, profile.sub, lang, ctx, text, m.text ?? '');
        case 'CHOOSE_DOCTOR': return await this.onDoctor(conv, profile.sub, lang, ctx, text);
        case 'CHOOSE_SLOT': return await this.onSlot(conv, profile.sub, lang, ctx, text);
        case 'OFFER_WAITLIST': return await this.onWaitlist(conv, profile.sub, lang, ctx, text);
        case 'CONFIRM': return await this.onConfirm(conv, profile.sub, lang, ctx, text);
      }
    } catch (e) {
      return this.fail(conv, profile.sub, lang, ctx, e);
    }
  }

  private async marketLive(market: string) { try { await this.markets.assertLive(market); return true; } catch { return false; } }

  private async releaseHeld(sub: string | null, ctx: Ctx) {
    if (sub && ctx.bookingId) await this.booking.release(sub, ctx.bookingId).catch(() => undefined);
  }

  // ───────────── steps ─────────────

  private async start(c: ChannelConversation, sub: string, lang: Lang, raw: string) {
    const mapped = mapSymptomToSpecialties(raw);
    if (mapped.length) return this.showDoctors(c, sub, lang, {}, mapped[0]);
    await this.save(c, 'CHOOSE_SPECIALTY', { specialties: SHOWN_SPECIALTIES });
    return this.reply(c, 'choose_specialty', copy.chooseSpecialty(lang, SHOWN_SPECIALTIES), sub);
  }

  private async onSpecialty(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, text: string, raw: string) {
    const idx = /^\d+$/.test(text) ? Number(text) - 1 : -1;
    const code = idx >= 0 ? ctx.specialties?.[idx] : mapSymptomToSpecialties(raw)[0];
    if (!code) return this.reply(c, 'invalid', copy.invalid(lang), sub);
    return this.showDoctors(c, sub, lang, ctx, code);
  }

  private async showDoctors(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, specialty: SpecialtyCode) {
    const res: any = await this.catalog.search({ specialty, sort: 'earliest', pageSize: 3 });
    const items = (res.items ?? []).filter((i: any) => i.bookable && i.defaultTypeId).slice(0, 3);
    if (!items.length) { await this.save(c, 'CHOOSE_SPECIALTY', { specialties: ctx.specialties ?? SHOWN_SPECIALTIES }); return this.reply(c, 'no_doctors', copy.noDoctors(lang), sub); }
    const doctors = items.map((i: any) => ({ id: i.id, typeId: i.defaultTypeId, name: (lang === 'ar' ? i.nameAr : i.nameEn) ?? i.nameEn ?? i.nameAr, fee: i.minFeeMinor, currency: i.currency }));
    await this.save(c, 'CHOOSE_DOCTOR', { doctors: doctors.map(({ id, typeId, name }: any) => ({ id, typeId, name })) });
    return this.reply(c, 'choose_doctor', copy.chooseDoctor(lang, doctors), sub);
  }

  private async onDoctor(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, text: string) {
    const d = /^\d+$/.test(text) ? ctx.doctors?.[Number(text) - 1] : undefined;
    if (!d) return this.reply(c, 'invalid', copy.invalid(lang), sub);
    return this.showSlots(c, sub, lang, { providerId: d.id, typeId: d.typeId, doctor: d.name });
  }

  private async showSlots(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, slotsOverride?: { startsAt: string; endsAt: string }[]) {
    const row = await this.catalog.getRow(ctx.providerId!);
    const now = new Date();
    const slots = (slotsOverride?.length ? slotsOverride : await this.catalog.slots(row, ctx.typeId!, now, new Date(now.getTime() + 7 * 86400_000))).slice(0, 5);
    if (!slots.length) { await this.save(c, 'OFFER_WAITLIST', ctx); return this.reply(c, 'no_slots', copy.noSlots(lang), sub); }
    await this.save(c, 'CHOOSE_SLOT', { ...ctx, slots });
    return this.reply(c, 'choose_slot', copy.chooseSlot(lang, slots), sub);
  }

  private async onWaitlist(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, text: string) {
    if (!YES.has(text)) return this.reply(c, 'invalid', copy.invalid(lang), sub);
    await this.waitlist.join(sub, { providerId: ctx.providerId!, typeId: ctx.typeId! });
    await this.save(c, 'IDLE', {});
    return this.reply(c, 'waitlisted', copy.waitlisted(lang), sub);
  }

  private async onSlot(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, text: string) {
    const s = /^\d+$/.test(text) ? ctx.slots?.[Number(text) - 1] : undefined;
    if (!s) return this.reply(c, 'invalid', copy.invalid(lang), sub);
    const b = await this.booking.createIntent(sub, { providerId: ctx.providerId!, typeId: ctx.typeId!, startsAt: s.startsAt, endsAt: s.endsAt, channel: 'WHATSAPP' }); // 5-minute hold (BK-02)
    await this.save(c, 'CONFIRM', { ...ctx, bookingId: b.id, startsAt: s.startsAt });
    return this.reply(c, 'held_confirm', copy.heldConfirm(lang, ctx.doctor ?? '', s.startsAt), sub);
  }

  private async onConfirm(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, text: string) {
    if (NO.has(text)) { await this.releaseHeld(sub, ctx); await this.save(c, 'IDLE', {}); return this.reply(c, 'cancelled', copy.cancelled(lang), sub); }
    if (!YES.has(text)) return this.reply(c, 'invalid', copy.invalid(lang), sub);
    const b = await this.booking.confirm(sub, ctx.bookingId!, { marketplaceConsent: true }); // idempotent: Idempotency-Key = booking id (BK-03/05)
    await this.save(c, 'IDLE', {});
    await this.reply(c, 'confirmed', copy.confirmed(lang, ctx.doctor ?? '', ctx.startsAt ?? b.startsAt.toString(), b.status === 'PENDING_CLINIC'), sub);
    if (b.depositStatus === 'REQUIRED' && (await this.flags.isEnabled('kiorex.pay_deposits', { market: 'EG' }))) {
      const d = await this.booking.depositCheckout(sub, b.id);
      await this.reply(c, 'deposit', copy.deposit(lang, d.checkoutUrl ?? ''), sub);
    }
  }

  private async fail(c: ChannelConversation, sub: string, lang: Lang, ctx: Ctx, e: unknown) {
    const body = e instanceof ApiError ? (e.getResponse() as Record<string, any>) : {};
    const code = body.code as string | undefined;
    const alts = (body.alternatives ?? []) as { startsAt: string; endsAt: string }[];
    if ((code === 'SLOT_TAKEN' || code === 'HOLD_EXPIRED') && ctx.providerId) {
      await this.reply(c, 'slot_taken', code === 'HOLD_EXPIRED' ? copy.holdExpired(lang) : copy.slotTaken(lang), sub);
      if (alts.length) { await this.save(c, 'CHOOSE_SLOT', { ...ctx, bookingId: undefined, slots: alts.slice(0, 3) }); return this.reply(c, 'choose_slot', copy.chooseSlot(lang, alts.slice(0, 3)), sub); }
      return this.showSlots(c, sub, lang, { ...ctx, bookingId: undefined });
    }
    if (code === 'CLINIC_SYSTEM_BUSY') return this.reply(c, 'busy', copy.busy(lang), sub);
    await this.releaseHeld(sub, ctx);
    await this.save(c, 'IDLE', {});
    return this.reply(c, 'generic', copy.generic(lang), sub);
  }

  conversation(phone: string) { return this.prisma.channelConversation.findUnique({ where: { channel_phone: { channel: 'WHATSAPP', phone } } }); }
}
