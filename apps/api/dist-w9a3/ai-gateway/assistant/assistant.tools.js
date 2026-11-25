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
exports.AssistantTools = exports.toolJsonSchemas = exports.toolSignatures = exports.TOOL_SPECS = void 0;
exports.validateArgs = validateArgs;
const common_1 = require("@nestjs/common");
const errors_1 = require("../../common/errors");
const booking_public_1 = require("../../booking/booking-public");
const catalog_public_1 = require("../../catalog/catalog-public");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const safety_public_1 = require("../../safety/safety-public");
const waitlist_public_1 = require("../../waitlist/waitlist-public");
const assistant_lexicon_1 = require("./assistant.lexicon");
const assistant_confirm_1 = require("./assistant.confirm");
const assistant_link_service_1 = require("./assistant.link.service");
const assistant_policy_1 = require("./assistant.policy");
const assistant_types_1 = require("./assistant.types");
const ID = '^[A-Za-z0-9_:.\\-]{1,64}$';
const ISO = '^\\d{4}-\\d{2}-\\d{2}T[\\d:.]{5,14}(?:Z|[+-]\\d{2}:\\d{2})$';
const DAY = '^\\d{4}-\\d{2}-\\d{2}$';
const PART = ['morning', 'afternoon', 'evening'];
exports.TOOL_SPECS = {
    search_providers: { description: 'Search bookable doctors by a specialty the patient named; read only.', props: { specialty: { type: 'string' }, district: { type: 'string', maxLength: 40, pattern: '^[a-z0-9 ]{2,40}$' }, city: { type: 'string', maxLength: 40, pattern: '^[a-z0-9 ]{2,40}$' }, maxPriceMinor: { type: 'integer', minimum: 0, maximum: 10_000_000 }, date: { type: 'string', pattern: DAY }, sameDay: { type: 'boolean' }, language: { type: 'string', enum: ['ar', 'en'] }, sortBy: { type: 'string', enum: ['price', 'earliest'] } } },
    get_slots: { description: 'Free times of a provider already shown to the patient.', props: { providerId: { type: 'string', pattern: ID }, from: { type: 'string', pattern: DAY }, to: { type: 'string', pattern: DAY }, date: { type: 'string', pattern: DAY }, sameDay: { type: 'boolean' }, part: { type: 'string', enum: PART } }, required: ['providerId'] },
    get_next_available: { description: 'The earliest free time of a provider already shown, or the earliest doctors of a named specialty.', props: { providerId: { type: 'string', pattern: ID }, specialty: { type: 'string' }, district: { type: 'string', maxLength: 40, pattern: '^[a-z0-9 ]{2,40}$' } } },
    hold_slot: { description: 'Hold a shown time for 5 minutes (no booking yet).', props: { providerId: { type: 'string', pattern: ID }, startsAt: { type: 'string', pattern: ISO } }, required: ['providerId', 'startsAt'] },
    prepare_confirmation: { description: 'Send the Confirm and Cancel buttons for the current hold.', props: { holdId: { type: 'string', pattern: ID } }, required: ['holdId'] },
    confirm_booking: { description: 'Runs only when the current inbound message is the exact button payload; never a model choice.', props: {} },
    get_my_bookings: { description: 'The signed-in patient\'s upcoming bookings.', props: { purpose: { type: 'string', enum: ['list', 'cancel', 'reschedule'] } } },
    reschedule_booking: { description: 'Ask to move a booking to a shown time; needs its own Confirm button.', props: { bookingId: { type: 'string', pattern: ID }, startsAt: { type: 'string', pattern: ISO } }, required: ['bookingId', 'startsAt'] },
    cancel_booking: { description: 'Ask to cancel a booking; shows the refund consequence and needs its own Confirm button.', props: { bookingId: { type: 'string', pattern: ID } }, required: ['bookingId'] },
    join_waitlist: { description: 'Join the waitlist of a provider that has no free time.', props: { providerId: { type: 'string', pattern: ID } }, required: ['providerId'] },
    create_booking_link: { description: 'A one-time signed link (15 minutes) to book, verify the number or pay.', props: { intent: { type: 'string', enum: ['BOOK', 'VERIFY', 'PAY'] }, providerId: { type: 'string', pattern: ID }, startsAt: { type: 'string', pattern: ISO } }, required: ['intent'] },
    handoff_to_human: { description: 'Pass the conversation to a person.', props: { reason: { type: 'string', enum: ['USER_REQUEST', 'UNABLE', 'COMPLAINT', 'OTHER'] } } },
    end_conversation: { description: 'Close the conversation politely.', props: {} },
};
const toolSignatures = () => assistant_types_1.TOOL_NAMES.map((n) => `${n}(${Object.entries(exports.TOOL_SPECS[n].props).map(([k, p]) => `${k}${(exports.TOOL_SPECS[n].required ?? []).includes(k) ? '' : '?'}:${p.enum ? p.enum.join('|') : p.type === 'integer' ? 'int' : p.type === 'boolean' ? 'bool' : 'str'}`).join(',')})`);
exports.toolSignatures = toolSignatures;
const toolJsonSchemas = () => assistant_types_1.TOOL_NAMES.map((n) => ({ name: n, description: exports.TOOL_SPECS[n].description, parameters: { type: 'object', additionalProperties: false, properties: exports.TOOL_SPECS[n].props, required: exports.TOOL_SPECS[n].required ?? [] } }));
exports.toolJsonSchemas = toolJsonSchemas;
function validateArgs(tool, raw) {
    const spec = exports.TOOL_SPECS[tool];
    if (!spec)
        return { ok: false, code: 'ARG_NOT_ALLOWED' };
    if (raw === undefined || raw === null)
        raw = {};
    if (typeof raw !== 'object' || Array.isArray(raw))
        return { ok: false, code: 'ARG_INVALID' };
    const o = raw;
    const out = {};
    for (const k of Object.keys(o))
        if (!(k in spec.props))
            return { ok: false, code: 'ARG_NOT_ALLOWED', key: k };
    for (const r of spec.required ?? [])
        if (o[r] === undefined)
            return { ok: false, code: 'ARG_MISSING', key: r };
    for (const [k, p] of Object.entries(spec.props)) {
        const v = o[k];
        if (v === undefined)
            continue;
        if (p.type === 'string') {
            if (typeof v !== 'string' || (p.maxLength && v.length > p.maxLength) || v.length > 200 || (p.enum && !p.enum.includes(v)) || (p.pattern && !new RegExp(p.pattern).test(v)))
                return { ok: false, code: 'ARG_INVALID', key: k };
        }
        else if (p.type === 'integer') {
            if (typeof v !== 'number' || !Number.isInteger(v) || (p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum))
                return { ok: false, code: 'ARG_INVALID', key: k };
        }
        else if (typeof v !== 'boolean')
            return { ok: false, code: 'ARG_INVALID', key: k };
        out[k] = v;
    }
    return { ok: true, args: out };
}
const fail = (tool, code, data) => ({ tool, ok: false, code, data });
const seen = (ctx, id) => ctx.idsSeen.includes(id);
const remember = (ctx, ...ids) => { for (const id of ids)
    if (id && !ctx.idsSeen.includes(id))
        ctx.idsSeen.push(id); if (ctx.idsSeen.length > 200)
    ctx.idsSeen.splice(0, ctx.idsSeen.length - 200); };
const slotKey = (providerId, startsAt) => `${providerId}@${startsAt}`;
const inRange = (day, today) => day >= today && day <= (0, assistant_lexicon_1.addDays)(today, assistant_policy_1.LIMITS.maxDateRangeDays);
const nameOf = (p, lang) => (lang === 'en' ? p.nameEn ?? p.nameAr : p.nameAr ?? p.nameEn) ?? '';
let AssistantTools = class AssistantTools {
    prisma;
    booking;
    catalog;
    waitlist;
    flags;
    confirms;
    links;
    log = new common_1.Logger('assistant-tools');
    constructor(prisma, booking, catalog, waitlist, flags, confirms, links) {
        this.prisma = prisma;
        this.booking = booking;
        this.catalog = catalog;
        this.waitlist = waitlist;
        this.flags = flags;
        this.confirms = confirms;
        this.links = links;
    }
    async run(tool, rawArgs, tc) {
        const v = validateArgs(tool, rawArgs);
        if (!v.ok)
            return { ...fail(tool, v.code, { key: v.key }), args: {} };
        if (!tc.verified && !assistant_policy_1.UNVERIFIED_TOOLS.includes(tool))
            return { ...fail(tool, 'NOT_VERIFIED'), args: v.args };
        try {
            return { ...(await this.exec(tool, v.args, tc)), args: v.args };
        }
        catch (e) {
            if (e instanceof errors_1.ApiError) {
                const b = e.getResponse();
                return { ...fail(tool, String(b.code ?? 'ERROR')), args: v.args };
            }
            this.log.warn(`tool ${tool} failed: ${e.constructor.name}`);
            return { ...fail(tool, 'ERROR'), args: v.args };
        }
    }
    async exec(tool, a, tc) {
        switch (tool) {
            case 'search_providers': return this.search(a, tc);
            case 'get_slots': return this.getSlots(a, tc);
            case 'get_next_available': return a.providerId ? this.getSlots({ providerId: a.providerId, first: true }, tc) : this.search({ specialty: a.specialty, district: a.district, sortBy: 'earliest' }, tc);
            case 'hold_slot': return this.hold(a, tc);
            case 'prepare_confirmation': return this.prepare(a, tc);
            case 'confirm_booking': return this.confirm(tc);
            case 'get_my_bookings': return this.myBookings(a, tc);
            case 'cancel_booking': return this.cancelRequest(a, tc);
            case 'reschedule_booking': return this.rescheduleRequest(a, tc);
            case 'join_waitlist': return this.joinWaitlist(a, tc);
            case 'create_booking_link': return this.link(a, tc);
            case 'handoff_to_human': return { tool, ok: true, handoff: true, state: 'HANDOFF', data: { reason: a.reason ?? 'OTHER' } };
            case 'end_conversation': return { tool, ok: true, end: true, state: 'CLOSED' };
        }
    }
    async search(a, tc) {
        const tool = 'search_providers';
        let specialty = a.specialty;
        if (specialty !== undefined) {
            if (!(0, safety_public_1.isSpecialtyCode)(specialty))
                return fail(tool, 'SPECIALTY_NOT_ALLOWED');
            if (!tc.named.includes(specialty) && tc.ctx.specialty !== specialty)
                return fail(tool, 'SPECIALTY_NOT_NAMED');
        }
        else if (tc.ctx.specialty)
            specialty = tc.ctx.specialty;
        if (!specialty)
            return fail(tool, 'SPECIALTY_REQUIRED');
        if (a.date !== undefined && !inRange(a.date, tc.today))
            return fail(tool, 'DATE_OUT_OF_RANGE');
        const nextAvailable = a.sameDay || a.date === tc.today ? 'today' : a.date === (0, assistant_lexicon_1.addDays)(tc.today, 1) ? 'tomorrow' : a.date ? 'week' : undefined;
        const base = { specialty, sort: (a.sortBy === 'price' ? 'fee' : 'earliest'), pageSize: assistant_policy_1.LIMITS.maxSearchResults, ...(a.maxPriceMinor ? { maxFee: a.maxPriceMinor / 100 } : {}), ...(a.language ? { language: a.language } : {}), ...(nextAvailable ? { nextAvailable: nextAvailable } : {}) };
        let res = await this.catalog.search({ ...base, ...(a.district ? { area: a.district } : {}) });
        let areaRelaxed = false;
        if (a.district && !(res.items ?? []).some((i) => i.bookable && i.defaultTypeId)) {
            res = await this.catalog.search(base);
            areaRelaxed = true;
        }
        if (res.emergency)
            return fail(tool, 'EMERGENCY');
        const items = (res.items ?? []).filter((i) => i.bookable && i.defaultTypeId).slice(0, assistant_policy_1.LIMITS.maxSearchResults);
        tc.ctx.specialty = specialty;
        if (!items.length) {
            tc.ctx.shown = { ...tc.ctx.shown, providers: [], lastList: null };
            return { tool, ok: true, state: 'SEARCHING', data: { providers: [], specialty, areaRelaxed } };
        }
        const providers = items.map((i, idx) => ({ n: idx + 1, id: i.id, typeId: i.defaultTypeId, name: nameOf(i, tc.lang), nameAr: i.nameAr, nameEn: i.nameEn, feeMinor: i.minFeeMinor ?? null, currency: i.currency ?? 'EGP', nextSlotAt: i.nextSlots?.[0]?.startsAt ?? null }));
        tc.ctx.shown = { ...tc.ctx.shown, providers: providers.map((p) => ({ n: p.n, id: p.id, typeId: p.typeId })), slots: [], lastList: 'providers', specialties: [], slotsProviderId: undefined };
        remember(tc.ctx, ...providers.map((p) => p.id));
        return { tool, ok: true, state: 'PICKING', data: { providers, specialty, areaRelaxed } };
    }
    async getSlots(a, tc) {
        const tool = 'get_slots';
        if (!seen(tc.ctx, a.providerId))
            return fail(tool, 'ID_NOT_SEEN');
        const day = a.date;
        if (day !== undefined && !inRange(day, tc.today))
            return fail(tool, 'DATE_OUT_OF_RANGE');
        const from = a.from ?? day ?? tc.today;
        const to = a.to ?? day ?? (0, assistant_lexicon_1.addDays)(from, 7);
        if (!inRange(from, tc.today) || to < from || to > (0, assistant_lexicon_1.addDays)(tc.today, assistant_policy_1.LIMITS.maxDateRangeDays) || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > assistant_policy_1.LIMITS.maxDateRangeDays)
            return fail(tool, 'DATE_OUT_OF_RANGE');
        const row = await this.catalog.getRow(a.providerId);
        const typeId = tc.ctx.shown.providers.find((p) => p.id === a.providerId)?.typeId ?? tc.ctx.shown.bookings.find((b) => b.providerId === a.providerId)?.typeId ?? (row.raw?.provider?.fees ?? [])[0]?.appointmentTypeId;
        if (!typeId)
            return fail(tool, 'NOT_BOOKABLE');
        const start = new Date(Math.max(Date.now(), Date.parse(`${from}T00:00:00Z`) - 3 * 3_600_000));
        const end = new Date(Date.parse(`${to}T00:00:00Z`) + 27 * 3_600_000);
        let slots = (await this.catalog.slots(row, typeId, start, end)).filter((s) => new Date(s.startsAt).getTime() > Date.now());
        if (a.sameDay)
            slots = slots.filter((s) => (0, assistant_lexicon_1.marketDate)(new Date(s.startsAt)) === tc.today);
        if (day)
            slots = slots.filter((s) => (0, assistant_lexicon_1.marketDate)(new Date(s.startsAt)) === day);
        else
            slots = slots.filter((s) => (0, assistant_lexicon_1.marketDate)(new Date(s.startsAt)) >= from && (0, assistant_lexicon_1.marketDate)(new Date(s.startsAt)) <= to);
        if (a.part)
            slots = slots.filter((s) => (0, assistant_lexicon_1.partOfHour)((0, assistant_lexicon_1.marketHour)(s.startsAt)) === a.part);
        slots = slots.slice(0, a.first ? 1 : assistant_policy_1.LIMITS.maxSlotsShown);
        const doctor = nameOf(row, tc.lang);
        const stay = tc.state === 'RESCHEDULE_FLOW' ? 'RESCHEDULE_FLOW' : 'PICKING';
        if (!slots.length) {
            tc.ctx.shown = { ...tc.ctx.shown, slots: [], lastList: null, slotsProviderId: a.providerId };
            tc.ctx.waitlistOffer = { providerId: a.providerId, typeId };
            return { tool, ok: true, state: stay, data: { providerId: a.providerId, doctor, slots: [], canWaitlist: tc.verified } };
        }
        tc.ctx.shown = { ...tc.ctx.shown, slots: slots.map((s, i) => ({ n: i + 1, startsAt: s.startsAt, endsAt: s.endsAt })), lastList: 'slots', slotsProviderId: a.providerId };
        remember(tc.ctx, ...slots.map((s) => slotKey(a.providerId, s.startsAt)));
        tc.ctx.providerId = a.providerId;
        tc.ctx.typeId = typeId;
        tc.ctx.doctor = doctor;
        return { tool, ok: true, state: stay, data: { providerId: a.providerId, doctor, slots: slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })), canWaitlist: tc.verified } };
    }
    async hold(a, tc) {
        const tool = 'hold_slot';
        if (!seen(tc.ctx, a.providerId) || !seen(tc.ctx, slotKey(a.providerId, a.startsAt)))
            return fail(tool, 'ID_NOT_SEEN');
        const typeId = tc.ctx.shown.providers.find((p) => p.id === a.providerId)?.typeId ?? (tc.ctx.providerId === a.providerId ? tc.ctx.typeId : undefined);
        if (!typeId)
            return fail(tool, 'NOT_BOOKABLE');
        const slot = tc.ctx.shown.slots.find((s) => s.startsAt === a.startsAt);
        if (tc.ctx.pendingHold) {
            await this.booking.release(tc.sub, tc.ctx.pendingHold.bookingId).catch(() => undefined);
            await this.confirms.revokeFor(tc.sessionId, tc.ctx.pendingHold.bookingId);
            tc.ctx.pendingHold = undefined;
        }
        let b;
        try {
            b = await this.booking.createIntent(tc.sub, { providerId: a.providerId, typeId, startsAt: a.startsAt, ...(slot ? { endsAt: slot.endsAt } : {}), channel: 'WHATSAPP' });
        }
        catch (e) {
            if (e instanceof errors_1.ApiError) {
                const body = e.getResponse();
                if (body.code === 'SLOT_TAKEN')
                    return { tool, ok: false, code: 'SLOT_TAKEN', state: 'PICKING' };
                if (body.code === 'CLINIC_SYSTEM_BUSY')
                    return fail(tool, 'BUSY');
            }
            throw e;
        }
        const doctor = b.doctor ? (tc.lang === 'en' ? b.doctor.nameEn ?? b.doctor.nameAr : b.doctor.nameAr ?? b.doctor.nameEn) : tc.ctx.doctor ?? '';
        tc.ctx.pendingHold = { bookingId: b.id, startsAt: a.startsAt, doctor, expiresAt: b.holdExpiresAt ? new Date(b.holdExpiresAt).toISOString() : undefined };
        remember(tc.ctx, b.id);
        return { tool, ok: true, state: 'HOLDING', data: { holdId: b.id, providerId: a.providerId, doctor, startsAt: a.startsAt, expiresAt: b.holdExpiresAt, feeMinor: b.feeMinor ?? null, currency: b.currency ?? 'EGP', depositMinor: b.depositStatus === 'REQUIRED' ? b.depositAmountMinor : null } };
    }
    async prepare(a, tc) {
        const tool = 'prepare_confirmation';
        if (!seen(tc.ctx, a.holdId) || tc.ctx.pendingHold?.bookingId !== a.holdId)
            return fail(tool, 'ID_NOT_SEEN');
        const b = await this.booking.get(tc.sub, a.holdId);
        if (b.status !== 'HELD' || (b.holdExpiresAt && new Date(b.holdExpiresAt) <= tc.now)) {
            tc.ctx.pendingHold = undefined;
            return { tool, ok: false, code: 'HOLD_EXPIRED', state: 'PICKING' };
        }
        const n = await this.confirms.issue({ sessionId: tc.sessionId, sub: tc.sub, kind: 'BOOK', targetRef: a.holdId, ttlMinutes: assistant_policy_1.LIMITS.holdMinutes });
        return { tool, ok: true, state: 'CONFIRMING', confirmNonceHash: n.nonceHash, data: { kind: 'BOOK', confirmId: n.confirmId, declineId: n.declineId, doctor: tc.ctx.pendingHold.doctor, startsAt: tc.ctx.pendingHold.startsAt, feeMinor: b.feeMinor ?? null, currency: b.currency ?? 'EGP', depositMinor: b.depositStatus === 'REQUIRED' ? b.depositAmountMinor : null } };
    }
    async confirm(tc) {
        const tool = 'confirm_booking';
        const btn = tc.button ?? (0, assistant_confirm_1.parseButton)(undefined);
        if (!btn)
            return fail(tool, 'NOT_BUTTON');
        const r = await this.confirms.consume(btn, { sessionId: tc.sessionId, sub: tc.sub }, tc.now);
        if (!r.ok)
            return { tool, ok: false, code: r.code === 'USED' ? 'ALREADY_DONE' : r.code === 'EXPIRED' ? 'CONFIRM_EXPIRED' : 'CONFIRM_INVALID', data: { kind: r.kind, outcome: r.outcome } };
        const declined = btn.decision === 'DECLINE';
        const fin = (state, data, ref) => { if (ref)
            void this.confirms.setResult(r.id, ref); return { tool, ok: true, state, resultRef: ref, data: { kind: r.kind, declined, ...data } }; };
        if (r.kind === 'BOOK') {
            const holdId = r.targetRef;
            const pend = tc.ctx.pendingHold;
            tc.ctx.pendingHold = undefined;
            if (declined) {
                await this.booking.release(tc.sub, holdId).catch(() => undefined);
                return fin('UNDERSTAND', {}, holdId);
            }
            let b;
            try {
                b = await this.booking.confirm(tc.sub, holdId, { marketplaceConsent: true });
            }
            catch (e) {
                if (e instanceof errors_1.ApiError) {
                    const code = String(e.getResponse().code);
                    if (code === 'SLOT_TAKEN' || code === 'HOLD_EXPIRED')
                        return { tool, ok: false, code, state: 'PICKING' };
                    if (code === 'CLINIC_SYSTEM_BUSY')
                        return fail(tool, 'BUSY');
                }
                throw e;
            }
            let link;
            if (b.depositStatus === 'REQUIRED' && (await this.flags.isEnabled('kiorex.pay_deposits', { market: tc.market }))) {
                const l = await this.links.create({ phoneHash: tc.phoneHash, intent: 'PAY', payload: { bookingId: b.id } });
                if (l) {
                    link = l.url;
                    tc.allowedUrls.add(l.url);
                }
            }
            return fin('DONE', { doctor: pend?.doctor ?? '', startsAt: pend?.startsAt ?? new Date(b.startsAt).toISOString(), pendingClinic: b.status === 'PENDING_CLINIC', link }, holdId);
        }
        if (declined)
            return fin('UNDERSTAND', {}, r.targetRef);
        if (r.kind === 'CANCEL') {
            const b = await this.booking.cancel(tc.sub, r.targetRef, 'patient_whatsapp_assistant');
            return fin('DONE', { status: b.status }, r.targetRef);
        }
        const b = await this.booking.reschedule(tc.sub, r.targetRef, { startsAt: String(r.payload.startsAt), ...(r.payload.endsAt ? { endsAt: String(r.payload.endsAt) } : {}) });
        return fin('DONE', { doctor: nameOf(b.doctor ?? {}, tc.lang), startsAt: new Date(b.startsAt).toISOString() }, r.targetRef);
    }
    async myBookings(a, tc) {
        const tool = 'get_my_bookings';
        const purpose = (a.purpose ?? 'list');
        const ids = await this.prisma.bookingIntent.findMany({ where: { sub: tc.sub, status: { in: ['CONFIRMED', 'PENDING_CLINIC'] }, startsAt: { gt: tc.now } }, orderBy: { startsAt: 'asc' }, take: 5, select: { id: true } });
        const rows = await Promise.all(ids.map((x) => this.booking.get(tc.sub, x.id)));
        const bookings = rows.map((b, i) => ({ n: i + 1, id: b.id, status: b.status, providerId: b.providerId, typeId: b.typeId, doctor: b.doctor ? nameOf(b.doctor, tc.lang) : '', startsAt: new Date(b.startsAt).toISOString() }));
        tc.ctx.shown = { ...tc.ctx.shown, bookings: bookings.map(({ n, id, status, providerId, typeId }) => ({ n, id, status, providerId, typeId })), lastList: bookings.length ? 'bookings' : null, slots: [] };
        remember(tc.ctx, ...bookings.map((b) => b.id), ...bookings.map((b) => b.providerId));
        const state = !bookings.length ? 'UNDERSTAND' : purpose === 'cancel' ? 'CANCEL_FLOW' : purpose === 'reschedule' ? 'RESCHEDULE_FLOW' : 'DONE';
        return { tool, ok: true, state, data: { bookings, purpose, count: bookings.length, firstId: bookings[0]?.id, firstProviderId: bookings[0]?.providerId } };
    }
    async cancelRequest(a, tc) {
        const tool = 'cancel_booking';
        if (!seen(tc.ctx, a.bookingId))
            return fail(tool, 'ID_NOT_SEEN');
        const b = await this.booking.get(tc.sub, a.bookingId);
        if (!['CONFIRMED', 'PENDING_CLINIC'].includes(b.status))
            return fail(tool, 'NOT_CHANGEABLE');
        const n = await this.confirms.issue({ sessionId: tc.sessionId, sub: tc.sub, kind: 'CANCEL', targetRef: a.bookingId });
        tc.ctx.target = { kind: 'CANCEL', bookingId: a.bookingId, providerId: b.providerId };
        return { tool, ok: true, state: 'CONFIRMING', confirmNonceHash: n.nonceHash, data: { kind: 'CANCEL', confirmId: n.confirmId, declineId: n.declineId, doctor: b.doctor ? nameOf(b.doctor, tc.lang) : '', startsAt: new Date(b.startsAt).toISOString(), depositMinor: b.depositStatus && b.depositStatus !== 'NONE' ? b.depositAmountMinor : null, currency: b.currency ?? 'EGP', depositRefundable: typeof b.depositRefundable === 'boolean' ? b.depositRefundable : null } };
    }
    async rescheduleRequest(a, tc) {
        const tool = 'reschedule_booking';
        if (!seen(tc.ctx, a.bookingId))
            return fail(tool, 'ID_NOT_SEEN');
        const b = await this.booking.get(tc.sub, a.bookingId);
        if (b.status !== 'CONFIRMED')
            return fail(tool, 'NOT_CHANGEABLE');
        if (!seen(tc.ctx, slotKey(b.providerId, a.startsAt)))
            return fail(tool, 'ID_NOT_SEEN');
        const slot = tc.ctx.shown.slots.find((s) => s.startsAt === a.startsAt);
        const n = await this.confirms.issue({ sessionId: tc.sessionId, sub: tc.sub, kind: 'RESCHEDULE', targetRef: a.bookingId, payload: { startsAt: a.startsAt, ...(slot ? { endsAt: slot.endsAt } : {}) } });
        tc.ctx.target = { kind: 'RESCHEDULE', bookingId: a.bookingId, providerId: b.providerId };
        return { tool, ok: true, state: 'CONFIRMING', confirmNonceHash: n.nonceHash, data: { kind: 'RESCHEDULE', confirmId: n.confirmId, declineId: n.declineId, doctor: b.doctor ? nameOf(b.doctor, tc.lang) : '', oldStartsAt: new Date(b.startsAt).toISOString(), newStartsAt: a.startsAt } };
    }
    async joinWaitlist(a, tc) {
        const tool = 'join_waitlist';
        const offer = tc.ctx.waitlistOffer;
        if (!seen(tc.ctx, a.providerId) || !offer || offer.providerId !== a.providerId)
            return fail(tool, 'ID_NOT_SEEN');
        try {
            await this.waitlist.join(tc.sub, { providerId: a.providerId, typeId: offer.typeId });
        }
        catch (e) {
            if (e instanceof errors_1.ApiError)
                return fail(tool, 'WAITLIST_UNAVAILABLE');
            throw e;
        }
        tc.ctx.waitlistOffer = undefined;
        return { tool, ok: true, state: 'DONE', data: { joined: true } };
    }
    async link(a, tc) {
        const tool = 'create_booking_link';
        const intent = tc.verified ? a.intent : 'VERIFY';
        if (a.providerId && !seen(tc.ctx, a.providerId))
            return fail(tool, 'ID_NOT_SEEN');
        if (a.startsAt && (!a.providerId || !seen(tc.ctx, slotKey(a.providerId, a.startsAt))))
            return fail(tool, 'ID_NOT_SEEN');
        const typeId = a.providerId ? tc.ctx.shown.providers.find((p) => p.id === a.providerId)?.typeId ?? (tc.ctx.providerId === a.providerId ? tc.ctx.typeId : undefined) : undefined;
        const l = await this.links.create({ phoneHash: tc.phoneHash, intent, payload: { providerId: a.providerId, startsAt: a.startsAt, typeId } });
        if (!l)
            return fail(tool, 'LINK_UNAVAILABLE');
        tc.allowedUrls.add(l.url);
        return { tool, ok: true, data: { url: l.url, intent, expiresAt: l.expiresAt.toISOString() } };
    }
};
exports.AssistantTools = AssistantTools;
exports.AssistantTools = AssistantTools = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, booking_public_1.BookingService, catalog_public_1.CatalogService, waitlist_public_1.WaitlistService, control_plane_public_1.FlagsService, assistant_confirm_1.ConfirmationStore, assistant_link_service_1.AssistantLinkService])
], AssistantTools);
//# sourceMappingURL=assistant.tools.js.map