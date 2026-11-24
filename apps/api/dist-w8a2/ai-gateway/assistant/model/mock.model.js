"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MockAssistantModel = void 0;
const assistant_lexicon_1 = require("../assistant.lexicon");
const safety_public_1 = require("../../../safety/safety-public");
const approxTokens = (s) => Math.max(1, Math.ceil(s.length / 4));
class MockAssistantModel {
    opts;
    name = 'mock-rules-v1';
    mode = 'mock';
    usage = { tokensIn: 0, tokensOut: 0, costMinor: 0 };
    constructor(opts = {}) {
        this.opts = opts;
    }
    lastUsage() { return this.usage; }
    async step(i) {
        const out = this.decide(i);
        const tin = approxTokens(i.prompt.user);
        const tout = approxTokens(JSON.stringify(out));
        this.usage = { tokensIn: tin, tokensOut: tout, costMinor: Math.ceil(((tin + tout) / 1000) * (this.opts.costPer1kTokensMinor ?? Number(process.env.ASSISTANT_MOCK_COST_PER_1K_MINOR ?? 0))) };
        return out;
    }
    decide(i) {
        if (i.toolResults.length)
            return this.afterTool(i);
        const f = (0, assistant_lexicon_1.analyse)(i.text, { lang: i.lang, dialect: i.dialect });
        const has = (t) => i.allowedTools.includes(t);
        const lastList = this.lastList(i.shown);
        if (f.intents.has('HANDOFF'))
            return { kind: 'handoff', reason: 'USER_REQUEST' };
        if (f.intents.has('THANKS') && !f.intents.has('BOOK'))
            return { kind: 'reply_intent', intent: 'thanks' };
        if (f.intents.has('SHORT_YES') && i.state === 'CONFIRMING')
            return { kind: 'reply_intent', intent: 'use_buttons' };
        if (f.intents.has('SHORT_NO') && i.state === 'CONFIRMING')
            return { kind: 'reply_intent', intent: 'use_buttons' };
        if (f.intents.has('CANCEL'))
            return this.manage(i, f, 'cancel');
        if (f.intents.has('RESCHEDULE'))
            return this.manage(i, f, 'reschedule');
        if (f.intents.has('MY_BOOKINGS'))
            return has('get_my_bookings') ? { kind: 'tool', tool: 'get_my_bookings', args: { purpose: 'list' } } : { kind: 'reply_intent', intent: 'unverified_notice' };
        if (f.pick) {
            if (i.state === 'CANCEL_FLOW' && i.shown.bookings[f.pick - 1])
                return { kind: 'tool', tool: 'cancel_booking', args: { bookingId: i.shown.bookings[f.pick - 1].id } };
            if (i.state === 'RESCHEDULE_FLOW' && i.shown.slots.length && i.shown.bookings.length && lastList === 'slots') {
                const s = i.shown.slots[f.pick - 1];
                const b = i.shown.bookings[0];
                return s && b ? { kind: 'tool', tool: 'reschedule_booking', args: { bookingId: b.id, startsAt: s.startsAt } } : { kind: 'clarify', slot: 'slot' };
            }
            if (i.state === 'RESCHEDULE_FLOW' && lastList === 'bookings' && i.shown.bookings[f.pick - 1]) {
                const b = i.shown.bookings[f.pick - 1];
                return { kind: 'tool', tool: 'get_slots', args: { providerId: b.providerId } };
            }
            if (lastList === 'slots') {
                const s = i.shown.slots[f.pick - 1];
                if (s && i.shown.slotsProviderId && !i.verified)
                    return { kind: 'tool', tool: 'create_booking_link', args: { intent: 'VERIFY', providerId: i.shown.slotsProviderId, startsAt: s.startsAt } };
                return s && i.shown.slotsProviderId ? { kind: 'tool', tool: 'hold_slot', args: { providerId: i.shown.slotsProviderId, startsAt: s.startsAt } } : { kind: 'clarify', slot: 'slot' };
            }
            if (lastList === 'providers') {
                const p = i.shown.providers[f.pick - 1];
                return p ? { kind: 'tool', tool: 'get_slots', args: { providerId: p.id, ...(f.day === 'today' ? { sameDay: true } : {}), ...(f.part ? { part: f.part } : {}) } } : { kind: 'clarify', slot: 'provider' };
            }
            if (lastList === 'specialties') {
                const code = i.shown.specialties[f.pick - 1];
                return code ? { kind: 'tool', tool: 'search_providers', args: { specialty: code, ...this.filters(f, i.today) } } : { kind: 'clarify', slot: 'specialty' };
            }
        }
        const wantsSearch = f.intents.has('BOOK') || f.specialties.length > 0 || f.cheapest || f.day || f.area || f.maxPriceMinor || f.nearest;
        if (f.intents.has('WAITLIST') && has('join_waitlist') && i.shown.providers.length)
            return { kind: 'tool', tool: 'join_waitlist', args: { providerId: i.shown.providers[0].id } };
        if (f.nearest && !f.specialties.length && lastList === 'providers' && i.shown.providers[0])
            return { kind: 'tool', tool: 'get_next_available', args: { providerId: i.shown.providers[0].id } };
        if (f.specialties.length)
            return has('search_providers') ? { kind: 'tool', tool: 'search_providers', args: { specialty: f.specialties[0], ...this.filters(f, i.today) } } : { kind: 'reply_intent', intent: 'cannot_help' };
        if (wantsSearch && i.rememberedSpecialty && has('search_providers'))
            return { kind: 'tool', tool: 'search_providers', args: { specialty: i.rememberedSpecialty, ...this.filters(f, i.today) } };
        if ((0, safety_public_1.mapSymptomToSpecialties)(i.text).length)
            return { kind: 'reply_intent', intent: 'symptom_choose_specialty' };
        if (f.intents.has('BOOK') || wantsSearch)
            return { kind: 'clarify', slot: 'specialty' };
        if (f.intents.has('GREETING'))
            return { kind: 'reply_intent', intent: 'greet' };
        return { kind: 'clarify', slot: 'any' };
    }
    filters(f, today) {
        const a = {};
        if (f.area)
            a.district = f.area;
        if (f.maxPriceMinor)
            a.maxPriceMinor = f.maxPriceMinor;
        if (f.day === 'today')
            a.sameDay = true;
        if (f.day === 'tomorrow')
            a.date = (0, assistant_lexicon_1.addDays)(today, 1);
        if (f.day === 'after_tomorrow')
            a.date = (0, assistant_lexicon_1.addDays)(today, 2);
        if (f.cheapest)
            a.sortBy = 'price';
        return a;
    }
    manage(i, f, kind) {
        if (!i.verified)
            return { kind: 'reply_intent', intent: 'unverified_notice' };
        if (!i.shown.bookings.length || (i.state !== 'CANCEL_FLOW' && i.state !== 'RESCHEDULE_FLOW'))
            return { kind: 'tool', tool: 'get_my_bookings', args: { purpose: kind } };
        if (kind === 'cancel')
            return i.shown.bookings.length === 1 ? { kind: 'tool', tool: 'cancel_booking', args: { bookingId: i.shown.bookings[0].id } } : { kind: 'clarify', slot: 'booking' };
        return i.shown.bookings.length === 1 ? { kind: 'tool', tool: 'get_slots', args: { providerId: i.shown.bookings[0].providerId } } : { kind: 'clarify', slot: 'booking' };
    }
    afterTool(i) {
        const last = i.toolResults[i.toolResults.length - 1];
        if (last.tool === 'hold_slot' && last.ok && last.data?.holdId)
            return { kind: 'tool', tool: 'prepare_confirmation', args: { holdId: last.data.holdId } };
        if (last.tool === 'get_my_bookings' && last.ok && last.data?.purpose === 'cancel' && last.data.count === 1)
            return { kind: 'tool', tool: 'cancel_booking', args: { bookingId: last.data.firstId } };
        if (last.tool === 'get_my_bookings' && last.ok && last.data?.purpose === 'reschedule' && last.data.count === 1)
            return { kind: 'tool', tool: 'get_slots', args: { providerId: last.data.firstProviderId } };
        return { kind: 'reply_intent', intent: 'offer_help' };
    }
    lastList(s) { return s.lastList ?? null; }
}
exports.MockAssistantModel = MockAssistantModel;
//# sourceMappingURL=mock.model.js.map