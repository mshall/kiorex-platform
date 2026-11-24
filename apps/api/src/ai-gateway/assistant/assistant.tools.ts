import { Injectable, Logger } from '@nestjs/common';
import { ApiError } from '../../common/errors';
import { BookingService } from '../../booking/booking-public';
import { CatalogService } from '../../catalog/catalog-public';
import { FlagsService } from '../../control-plane/control-plane-public';
import { PrismaService } from '../../prisma/prisma.service';
import { isSpecialtyCode, type SpecialtyCode } from '../../safety/safety-public';
import { WaitlistService } from '../../waitlist/waitlist-public';
import { addDays, marketDate, marketHour, partOfHour, type DayPart } from './assistant.lexicon';
import { ConfirmationStore, parseButton, type ParsedButton } from './assistant.confirm';
import { AssistantLinkService, type LinkIntent } from './assistant.link.service';
import { LIMITS, UNVERIFIED_TOOLS } from './assistant.policy';
import type { AssistantPolicy } from './assistant.config';
import { TOOL_NAMES, type Dialect, type Lang, type SessionContext, type SessionState, type ToolName, type ToolResult } from './assistant.types';

/**
 * GRW-P2-D closed tool registry. Each tool has a JSON Schema (also what a real model is told), a validator generated FROM that schema (so they cannot diverge), allowed states (assistant.policy.ts)
 * and an executor bound to the existing services. Rules that hold for every tool:
 *  - none takes a subject, phone, tenant or any identity argument: the verified `sub` comes from the session (an unknown key is `ARG_NOT_ALLOWED`);
 *  - every id (provider, slot, hold, booking) must come from an earlier tool result in THIS session (`idsSeen`); a guessed or foreign id is `ID_NOT_SEEN`;
 *  - `specialty` must be a closed `SpecialtyCode` the patient named (or picked from the list we showed): the model never maps a symptom to a specialty;
 *  - dates are inside [today, today + 30 days]; ownership of a booking is re-checked by the booking service on every call.
 */
type Prop = { type: 'string' | 'integer' | 'boolean'; enum?: readonly string[]; pattern?: string; maxLength?: number; minimum?: number; maximum?: number };
interface Spec { props: Record<string, Prop>; required?: readonly string[] }
const ID = '^[A-Za-z0-9_:.\\-]{1,64}$';
const ISO = '^\\d{4}-\\d{2}-\\d{2}T[\\d:.]{5,14}(?:Z|[+-]\\d{2}:\\d{2})$';
const DAY = '^\\d{4}-\\d{2}-\\d{2}$';
const PART = ['morning', 'afternoon', 'evening'] as const;

export const TOOL_SPECS: Record<ToolName, Spec & { description: string }> = {
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
/** One compact line per tool for the (static, cacheable) system prompt: `name(arg?:type, ...)`. */
export const toolSignatures = (): string[] => TOOL_NAMES.map((n) => `${n}(${Object.entries(TOOL_SPECS[n].props).map(([k, p]) => `${k}${(TOOL_SPECS[n].required ?? []).includes(k) ? '' : '?'}:${p.enum ? p.enum.join('|') : p.type === 'integer' ? 'int' : p.type === 'boolean' ? 'bool' : 'str'}`).join(',')})`);
export const toolJsonSchemas = () => TOOL_NAMES.map((n) => ({ name: n, description: TOOL_SPECS[n].description, parameters: { type: 'object', additionalProperties: false, properties: TOOL_SPECS[n].props, required: TOOL_SPECS[n].required ?? [] } }));

export type ArgResult = { ok: true; args: Record<string, any> } | { ok: false; code: 'ARG_NOT_ALLOWED' | 'ARG_INVALID' | 'ARG_MISSING'; key?: string };
export function validateArgs(tool: ToolName, raw: unknown): ArgResult {
  const spec = TOOL_SPECS[tool]; if (!spec) return { ok: false, code: 'ARG_NOT_ALLOWED' };
  if (raw === undefined || raw === null) raw = {};
  if (typeof raw !== 'object' || Array.isArray(raw)) return { ok: false, code: 'ARG_INVALID' };
  const o = raw as Record<string, unknown>; const out: Record<string, any> = {};
  for (const k of Object.keys(o)) if (!(k in spec.props)) return { ok: false, code: 'ARG_NOT_ALLOWED', key: k }; // sub, phone, tenant and anything else land here
  for (const r of spec.required ?? []) if (o[r] === undefined) return { ok: false, code: 'ARG_MISSING', key: r };
  for (const [k, p] of Object.entries(spec.props)) {
    const v = o[k]; if (v === undefined) continue;
    if (p.type === 'string') { if (typeof v !== 'string' || (p.maxLength && v.length > p.maxLength) || v.length > 200 || (p.enum && !p.enum.includes(v)) || (p.pattern && !new RegExp(p.pattern).test(v))) return { ok: false, code: 'ARG_INVALID', key: k }; }
    else if (p.type === 'integer') { if (typeof v !== 'number' || !Number.isInteger(v) || (p.minimum !== undefined && v < p.minimum) || (p.maximum !== undefined && v > p.maximum)) return { ok: false, code: 'ARG_INVALID', key: k }; }
    else if (typeof v !== 'boolean') return { ok: false, code: 'ARG_INVALID', key: k };
    out[k] = v;
  }
  return { ok: true, args: out };
}

export interface ToolContext {
  sessionId: string; market: string; sub: string | null; phoneHash: string; verified: boolean;
  lang: Lang; dialect: Dialect; state: SessionState; ctx: SessionContext; policy: AssistantPolicy;
  /** The patient's own words and picks this turn authorise a specialty argument. */
  named: SpecialtyCode[];
  button: ParsedButton | null; now: Date; today: string;
  /** URLs produced by create_booking_link this turn: the only URLs the output scanner lets through. */
  allowedUrls: Set<string>;
}
export interface ToolOutcome extends ToolResult { state?: SessionState; confirmNonceHash?: string; resultRef?: string; handoff?: boolean; end?: boolean }
const fail = (tool: ToolName, code: string, data?: Record<string, any>): ToolOutcome => ({ tool, ok: false, code, data });
const seen = (ctx: SessionContext, id: string) => ctx.idsSeen.includes(id);
const remember = (ctx: SessionContext, ...ids: string[]) => { for (const id of ids) if (id && !ctx.idsSeen.includes(id)) ctx.idsSeen.push(id); if (ctx.idsSeen.length > 200) ctx.idsSeen.splice(0, ctx.idsSeen.length - 200); };
const slotKey = (providerId: string, startsAt: string) => `${providerId}@${startsAt}`;
const inRange = (day: string, today: string) => day >= today && day <= addDays(today, LIMITS.maxDateRangeDays);
const nameOf = (p: { nameAr?: string | null; nameEn?: string | null }, lang: Lang) => (lang === 'en' ? p.nameEn ?? p.nameAr : p.nameAr ?? p.nameEn) ?? '';

@Injectable()
export class AssistantTools {
  private readonly log = new Logger('assistant-tools');
  constructor(private readonly prisma: PrismaService, private readonly booking: BookingService, private readonly catalog: CatalogService, private readonly waitlist: WaitlistService, private readonly flags: FlagsService, private readonly confirms: ConfirmationStore, private readonly links: AssistantLinkService) {}

  /** Gatekeeper used by the orchestrator: validates, checks the subject requirement, then executes. Never throws: every failure is a `ToolOutcome`. */
  async run(tool: ToolName, rawArgs: unknown, tc: ToolContext): Promise<ToolOutcome & { args: Record<string, any> }> {
    const v = validateArgs(tool, rawArgs);
    if (!v.ok) return { ...fail(tool, v.code, { key: v.key }), args: {} };
    if (!tc.verified && !UNVERIFIED_TOOLS.includes(tool)) return { ...fail(tool, 'NOT_VERIFIED'), args: v.args };
    try { return { ...(await this.exec(tool, v.args, tc)), args: v.args }; }
    catch (e) {
      if (e instanceof ApiError) { const b = e.getResponse() as Record<string, any>; return { ...fail(tool, String(b.code ?? 'ERROR')), args: v.args }; }
      this.log.warn(`tool ${tool} failed: ${(e as Error).constructor.name}`);
      return { ...fail(tool, 'ERROR'), args: v.args };
    }
  }

  private async exec(tool: ToolName, a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
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

  // ───────────── read tools ─────────────
  private async search(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'search_providers';
    let specialty: string | undefined = a.specialty;
    if (specialty !== undefined) {
      if (!isSpecialtyCode(specialty)) return fail(tool, 'SPECIALTY_NOT_ALLOWED');
      if (!tc.named.includes(specialty as SpecialtyCode) && tc.ctx.specialty !== specialty) return fail(tool, 'SPECIALTY_NOT_NAMED'); // the model may not choose a specialty for the patient
    } else if (tc.ctx.specialty) specialty = tc.ctx.specialty;
    if (!specialty) return fail(tool, 'SPECIALTY_REQUIRED');
    if (a.date !== undefined && !inRange(a.date, tc.today)) return fail(tool, 'DATE_OUT_OF_RANGE');
    const nextAvailable = a.sameDay || a.date === tc.today ? 'today' : a.date === addDays(tc.today, 1) ? 'tomorrow' : a.date ? 'week' : undefined;
    const base = { specialty, sort: (a.sortBy === 'price' ? 'fee' : 'earliest') as 'fee' | 'earliest', pageSize: LIMITS.maxSearchResults, ...(a.maxPriceMinor ? { maxFee: a.maxPriceMinor / 100 } : {}), ...(a.language ? { language: a.language } : {}), ...(nextAvailable ? { nextAvailable: nextAvailable as 'today' } : {}) };
    let res: any = await this.catalog.search({ ...base, ...(a.district ? { area: a.district } : {}) });
    let areaRelaxed = false;
    if (a.district && !(res.items ?? []).some((i: any) => i.bookable && i.defaultTypeId)) { res = await this.catalog.search(base); areaRelaxed = true; }
    if (res.emergency) return fail(tool, 'EMERGENCY');
    const items = (res.items ?? []).filter((i: any) => i.bookable && i.defaultTypeId).slice(0, LIMITS.maxSearchResults);
    tc.ctx.specialty = specialty;
    if (!items.length) { tc.ctx.shown = { ...tc.ctx.shown, providers: [], lastList: null }; return { tool, ok: true, state: 'SEARCHING', data: { providers: [], specialty, areaRelaxed } }; }
    const providers = items.map((i: any, idx: number) => ({ n: idx + 1, id: i.id as string, typeId: i.defaultTypeId as string, name: nameOf(i, tc.lang), nameAr: i.nameAr, nameEn: i.nameEn, feeMinor: i.minFeeMinor ?? null, currency: i.currency ?? 'EGP', nextSlotAt: i.nextSlots?.[0]?.startsAt ?? null }));
    tc.ctx.shown = { ...tc.ctx.shown, providers: providers.map((p: any) => ({ n: p.n, id: p.id, typeId: p.typeId })), slots: [], lastList: 'providers', specialties: [], slotsProviderId: undefined };
    remember(tc.ctx, ...providers.map((p: any) => p.id));
    return { tool, ok: true, state: 'PICKING', data: { providers, specialty, areaRelaxed } };
  }

  private async getSlots(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'get_slots';
    if (!seen(tc.ctx, a.providerId)) return fail(tool, 'ID_NOT_SEEN');
    const day: string | undefined = a.date;
    if (day !== undefined && !inRange(day, tc.today)) return fail(tool, 'DATE_OUT_OF_RANGE');
    const from = a.from ?? day ?? tc.today; const to = a.to ?? day ?? addDays(from, 7);
    if (!inRange(from, tc.today) || to < from || to > addDays(tc.today, LIMITS.maxDateRangeDays) || (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000 > LIMITS.maxDateRangeDays) return fail(tool, 'DATE_OUT_OF_RANGE');
    const row = await this.catalog.getRow(a.providerId);
    const typeId = tc.ctx.shown.providers.find((p) => p.id === a.providerId)?.typeId ?? tc.ctx.shown.bookings.find((b) => b.providerId === a.providerId)?.typeId ?? ((row.raw as any)?.provider?.fees ?? [])[0]?.appointmentTypeId;
    if (!typeId) return fail(tool, 'NOT_BOOKABLE');
    const start = new Date(Math.max(Date.now(), Date.parse(`${from}T00:00:00Z`) - 3 * 3_600_000)); const end = new Date(Date.parse(`${to}T00:00:00Z`) + 27 * 3_600_000);
    let slots = (await this.catalog.slots(row, typeId, start, end)).filter((s) => new Date(s.startsAt).getTime() > Date.now());
    if (a.sameDay) slots = slots.filter((s) => marketDate(new Date(s.startsAt)) === tc.today);
    if (day) slots = slots.filter((s) => marketDate(new Date(s.startsAt)) === day);
    else slots = slots.filter((s) => marketDate(new Date(s.startsAt)) >= from && marketDate(new Date(s.startsAt)) <= to);
    if (a.part) slots = slots.filter((s) => partOfHour(marketHour(s.startsAt)) === (a.part as DayPart));
    slots = slots.slice(0, a.first ? 1 : LIMITS.maxSlotsShown);
    const doctor = nameOf(row, tc.lang);
    const stay = tc.state === 'RESCHEDULE_FLOW' ? 'RESCHEDULE_FLOW' : 'PICKING';
    if (!slots.length) {
      tc.ctx.shown = { ...tc.ctx.shown, slots: [], lastList: null, slotsProviderId: a.providerId };
      tc.ctx.waitlistOffer = { providerId: a.providerId, typeId };
      return { tool, ok: true, state: stay, data: { providerId: a.providerId, doctor, slots: [], canWaitlist: tc.verified } };
    }
    tc.ctx.shown = { ...tc.ctx.shown, slots: slots.map((s, i) => ({ n: i + 1, startsAt: s.startsAt, endsAt: s.endsAt })), lastList: 'slots', slotsProviderId: a.providerId };
    remember(tc.ctx, ...slots.map((s) => slotKey(a.providerId, s.startsAt)));
    tc.ctx.providerId = a.providerId; tc.ctx.typeId = typeId; tc.ctx.doctor = doctor;
    return { tool, ok: true, state: stay, data: { providerId: a.providerId, doctor, slots: slots.map((s) => ({ startsAt: s.startsAt, endsAt: s.endsAt })), canWaitlist: tc.verified } };
  }

  // ───────────── hold and confirm ─────────────
  private async hold(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'hold_slot';
    if (!seen(tc.ctx, a.providerId) || !seen(tc.ctx, slotKey(a.providerId, a.startsAt))) return fail(tool, 'ID_NOT_SEEN');
    const typeId = tc.ctx.shown.providers.find((p) => p.id === a.providerId)?.typeId ?? (tc.ctx.providerId === a.providerId ? tc.ctx.typeId : undefined);
    if (!typeId) return fail(tool, 'NOT_BOOKABLE');
    const slot = tc.ctx.shown.slots.find((s) => s.startsAt === a.startsAt);
    if (tc.ctx.pendingHold) { await this.booking.release(tc.sub!, tc.ctx.pendingHold.bookingId).catch(() => undefined); await this.confirms.revokeFor(tc.sessionId, tc.ctx.pendingHold.bookingId); tc.ctx.pendingHold = undefined; }
    let b: any;
    try { b = await this.booking.createIntent(tc.sub!, { providerId: a.providerId, typeId, startsAt: a.startsAt, ...(slot ? { endsAt: slot.endsAt } : {}), channel: 'WHATSAPP' }); }
    catch (e) { if (e instanceof ApiError) { const body = e.getResponse() as Record<string, any>; if (body.code === 'SLOT_TAKEN') return { tool, ok: false, code: 'SLOT_TAKEN', state: 'PICKING' }; if (body.code === 'CLINIC_SYSTEM_BUSY') return fail(tool, 'BUSY'); } throw e; }
    const doctor = b.doctor ? (tc.lang === 'en' ? b.doctor.nameEn ?? b.doctor.nameAr : b.doctor.nameAr ?? b.doctor.nameEn) : tc.ctx.doctor ?? '';
    tc.ctx.pendingHold = { bookingId: b.id, startsAt: a.startsAt, doctor, expiresAt: b.holdExpiresAt ? new Date(b.holdExpiresAt).toISOString() : undefined };
    remember(tc.ctx, b.id);
    return { tool, ok: true, state: 'HOLDING', data: { holdId: b.id, providerId: a.providerId, doctor, startsAt: a.startsAt, expiresAt: b.holdExpiresAt, feeMinor: b.feeMinor ?? null, currency: b.currency ?? 'EGP', depositMinor: b.depositStatus === 'REQUIRED' ? b.depositAmountMinor : null } };
  }

  private async prepare(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'prepare_confirmation';
    if (!seen(tc.ctx, a.holdId) || tc.ctx.pendingHold?.bookingId !== a.holdId) return fail(tool, 'ID_NOT_SEEN');
    const b: any = await this.booking.get(tc.sub!, a.holdId);
    if (b.status !== 'HELD' || (b.holdExpiresAt && new Date(b.holdExpiresAt) <= tc.now)) { tc.ctx.pendingHold = undefined; return { tool, ok: false, code: 'HOLD_EXPIRED', state: 'PICKING' }; }
    const n = await this.confirms.issue({ sessionId: tc.sessionId, sub: tc.sub!, kind: 'BOOK', targetRef: a.holdId, ttlMinutes: LIMITS.holdMinutes });
    return { tool, ok: true, state: 'CONFIRMING', confirmNonceHash: n.nonceHash, data: { kind: 'BOOK', confirmId: n.confirmId, declineId: n.declineId, doctor: tc.ctx.pendingHold!.doctor, startsAt: tc.ctx.pendingHold!.startsAt, feeMinor: b.feeMinor ?? null, currency: b.currency ?? 'EGP', depositMinor: b.depositStatus === 'REQUIRED' ? b.depositAmountMinor : null } };
  }

  /** Executes the action behind a button. Only runs when the current inbound message IS that button payload and the nonce is valid, unused, unexpired and bound to this session and subject. */
  private async confirm(tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'confirm_booking';
    const btn = tc.button ?? parseButton(undefined);
    if (!btn) return fail(tool, 'NOT_BUTTON');
    const r = await this.confirms.consume(btn, { sessionId: tc.sessionId, sub: tc.sub! }, tc.now);
    if (!r.ok) return { tool, ok: false, code: r.code === 'USED' ? 'ALREADY_DONE' : r.code === 'EXPIRED' ? 'CONFIRM_EXPIRED' : 'CONFIRM_INVALID', data: { kind: r.kind, outcome: r.outcome } };
    const declined = btn.decision === 'DECLINE';
    const fin = (state: SessionState, data: Record<string, any>, ref?: string): ToolOutcome => { if (ref) void this.confirms.setResult(r.id, ref); return { tool, ok: true, state, resultRef: ref, data: { kind: r.kind, declined, ...data } }; };
    if (r.kind === 'BOOK') {
      const holdId = r.targetRef; const pend = tc.ctx.pendingHold;
      tc.ctx.pendingHold = undefined;
      if (declined) { await this.booking.release(tc.sub!, holdId).catch(() => undefined); return fin('UNDERSTAND', {}, holdId); }
      let b: any;
      try { b = await this.booking.confirm(tc.sub!, holdId, { marketplaceConsent: true }); } // idempotent: Idempotency-Key = booking id (BK-03/05)
      catch (e) { if (e instanceof ApiError) { const code = String((e.getResponse() as any).code); if (code === 'SLOT_TAKEN' || code === 'HOLD_EXPIRED') return { tool, ok: false, code, state: 'PICKING' }; if (code === 'CLINIC_SYSTEM_BUSY') return fail(tool, 'BUSY'); } throw e; }
      let link: string | undefined;
      if (b.depositStatus === 'REQUIRED' && (await this.flags.isEnabled('kiorex.pay_deposits', { market: tc.market }))) {
        const l = await this.links.create({ phoneHash: tc.phoneHash, intent: 'PAY', payload: { bookingId: b.id } });
        if (l) { link = l.url; tc.allowedUrls.add(l.url); }
      }
      return fin('DONE', { doctor: pend?.doctor ?? '', startsAt: pend?.startsAt ?? new Date(b.startsAt).toISOString(), pendingClinic: b.status === 'PENDING_CLINIC', link }, holdId);
    }
    if (declined) return fin('UNDERSTAND', {}, r.targetRef);
    if (r.kind === 'CANCEL') { const b: any = await this.booking.cancel(tc.sub!, r.targetRef, 'patient_whatsapp_assistant'); return fin('DONE', { status: b.status }, r.targetRef); }
    const b: any = await this.booking.reschedule(tc.sub!, r.targetRef, { startsAt: String(r.payload.startsAt), ...(r.payload.endsAt ? { endsAt: String(r.payload.endsAt) } : {}) });
    return fin('DONE', { doctor: nameOf(b.doctor ?? {}, tc.lang), startsAt: new Date(b.startsAt).toISOString() }, r.targetRef);
  }

  // ───────────── manage ─────────────
  private async myBookings(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'get_my_bookings'; const purpose = (a.purpose ?? 'list') as 'list' | 'cancel' | 'reschedule';
    // the patient's next bookings by start time (BookingService.list is newest-first and capped at 100, which hides the nearest visit of a patient with a long history); each is presented through BookingService
    const ids = await this.prisma.bookingIntent.findMany({ where: { sub: tc.sub!, status: { in: ['CONFIRMED', 'PENDING_CLINIC'] }, startsAt: { gt: tc.now } }, orderBy: { startsAt: 'asc' }, take: 5, select: { id: true } });
    const rows: any[] = await Promise.all(ids.map((x) => this.booking.get(tc.sub!, x.id)));
    const bookings = rows.map((b, i) => ({ n: i + 1, id: b.id as string, status: b.status as string, providerId: b.providerId as string, typeId: b.typeId as string, doctor: b.doctor ? nameOf(b.doctor, tc.lang) : '', startsAt: new Date(b.startsAt).toISOString() }));
    tc.ctx.shown = { ...tc.ctx.shown, bookings: bookings.map(({ n, id, status, providerId, typeId }) => ({ n, id, status, providerId, typeId })), lastList: bookings.length ? 'bookings' : null, slots: [] };
    remember(tc.ctx, ...bookings.map((b) => b.id), ...bookings.map((b) => b.providerId));
    const state: SessionState = !bookings.length ? 'UNDERSTAND' : purpose === 'cancel' ? 'CANCEL_FLOW' : purpose === 'reschedule' ? 'RESCHEDULE_FLOW' : 'DONE';
    return { tool, ok: true, state, data: { bookings, purpose, count: bookings.length, firstId: bookings[0]?.id, firstProviderId: bookings[0]?.providerId } };
  }

  private async cancelRequest(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'cancel_booking';
    if (!seen(tc.ctx, a.bookingId)) return fail(tool, 'ID_NOT_SEEN');
    const b: any = await this.booking.get(tc.sub!, a.bookingId); // 404 for a booking that is not the patient's: refused by construction
    if (!['CONFIRMED', 'PENDING_CLINIC'].includes(b.status)) return fail(tool, 'NOT_CHANGEABLE');
    const n = await this.confirms.issue({ sessionId: tc.sessionId, sub: tc.sub!, kind: 'CANCEL', targetRef: a.bookingId });
    tc.ctx.target = { kind: 'CANCEL', bookingId: a.bookingId, providerId: b.providerId };
    return { tool, ok: true, state: 'CONFIRMING', confirmNonceHash: n.nonceHash, data: { kind: 'CANCEL', confirmId: n.confirmId, declineId: n.declineId, doctor: b.doctor ? nameOf(b.doctor, tc.lang) : '', startsAt: new Date(b.startsAt).toISOString(), depositMinor: b.depositStatus && b.depositStatus !== 'NONE' ? b.depositAmountMinor : null, currency: b.currency ?? 'EGP', depositRefundable: typeof b.depositRefundable === 'boolean' ? b.depositRefundable : null } };
  }

  private async rescheduleRequest(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'reschedule_booking';
    if (!seen(tc.ctx, a.bookingId)) return fail(tool, 'ID_NOT_SEEN');
    const b: any = await this.booking.get(tc.sub!, a.bookingId);
    if (b.status !== 'CONFIRMED') return fail(tool, 'NOT_CHANGEABLE');
    if (!seen(tc.ctx, slotKey(b.providerId, a.startsAt))) return fail(tool, 'ID_NOT_SEEN');
    const slot = tc.ctx.shown.slots.find((s) => s.startsAt === a.startsAt);
    const n = await this.confirms.issue({ sessionId: tc.sessionId, sub: tc.sub!, kind: 'RESCHEDULE', targetRef: a.bookingId, payload: { startsAt: a.startsAt, ...(slot ? { endsAt: slot.endsAt } : {}) } });
    tc.ctx.target = { kind: 'RESCHEDULE', bookingId: a.bookingId, providerId: b.providerId };
    return { tool, ok: true, state: 'CONFIRMING', confirmNonceHash: n.nonceHash, data: { kind: 'RESCHEDULE', confirmId: n.confirmId, declineId: n.declineId, doctor: b.doctor ? nameOf(b.doctor, tc.lang) : '', oldStartsAt: new Date(b.startsAt).toISOString(), newStartsAt: a.startsAt } };
  }

  private async joinWaitlist(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'join_waitlist';
    const offer = tc.ctx.waitlistOffer;
    if (!seen(tc.ctx, a.providerId) || !offer || offer.providerId !== a.providerId) return fail(tool, 'ID_NOT_SEEN'); // only offered after a search found no free time
    try { await this.waitlist.join(tc.sub!, { providerId: a.providerId, typeId: offer.typeId }); }
    catch (e) { if (e instanceof ApiError) return fail(tool, 'WAITLIST_UNAVAILABLE'); throw e; }
    tc.ctx.waitlistOffer = undefined;
    return { tool, ok: true, state: 'DONE', data: { joined: true } };
  }

  private async link(a: Record<string, any>, tc: ToolContext): Promise<ToolOutcome> {
    const tool: ToolName = 'create_booking_link';
    const intent: LinkIntent = tc.verified ? a.intent : 'VERIFY'; // an unverified number can only ever be sent to verification (Passport)
    if (a.providerId && !seen(tc.ctx, a.providerId)) return fail(tool, 'ID_NOT_SEEN');
    if (a.startsAt && (!a.providerId || !seen(tc.ctx, slotKey(a.providerId, a.startsAt)))) return fail(tool, 'ID_NOT_SEEN');
    const typeId = a.providerId ? tc.ctx.shown.providers.find((p) => p.id === a.providerId)?.typeId ?? (tc.ctx.providerId === a.providerId ? tc.ctx.typeId : undefined) : undefined;
    const l = await this.links.create({ phoneHash: tc.phoneHash, intent, payload: { providerId: a.providerId, startsAt: a.startsAt, typeId } });
    if (!l) return fail(tool, 'LINK_UNAVAILABLE');
    tc.allowedUrls.add(l.url);
    return { tool, ok: true, data: { url: l.url, intent, expiresAt: l.expiresAt.toISOString() } };
  }
}
