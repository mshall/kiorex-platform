import { DEFAULT_MARKET } from '../../market/market-core-public';
import { inConversationMarket } from './assistant-market';
import { Injectable, Logger } from '@nestjs/common';
import { BookingService } from '../../booking/booking-public';
import { CatalogService } from '../../catalog/catalog-public';
import { MessagingHub } from '../../messaging/messaging-public';
import { PrismaService } from '../../prisma/prisma.service';
import { detectEmergency } from '../../safety/safety-public';
import { AssistantAudit, redactToolArgs, sha } from './assistant.audit';
import { AssistantPolicyService, type AssistantPolicy } from './assistant.config';
import { ConfirmationStore, parseButton } from './assistant.confirm';
import { AssistantCostService } from './assistant.cost.service';
import { AssistantEscalationService } from './assistant.escalation.service';
import { analyse, detectDialect, detectLang, marketDate, namedSpecialties } from './assistant.lexicon';
import { AssistantModelFactory } from './assistant.model.factory';
import { validateModelStep } from './assistant.model.port';
import { allowedTools, LIMITS } from './assistant.policy';
import { R, SHOWN_SPECIALTY_CODES, reply, type Rendered } from './assistant.render';
import { asksMedicalAdvice, redactForModel, redactForStorage, sanitiseInbound, scanOutbound, screenInbound, wrapUserField } from './assistant.safety';
import { AssistantSessionService, phoneHashOf } from './assistant.session.service';
import { AssistantTools, type ToolContext, type ToolOutcome } from './assistant.tools';
import type { Dialect, InboundText, Lang, ModelInput, ModelStep, ProfileRef, RouteDecision, SessionContext, SessionState, ToolName, ToolResult } from './assistant.types';
import { OpenAiCompatAssistantModel } from './model/openai-compat.model';
import { ModelUnavailableError } from './model/fallback.chain';

export const templateId = (key: string) => `TODO_NEEDS_HUMAN_wa_assistant_${key}`;
const CONTINUE_AFTER = new Set<ToolName>(['hold_slot']); // mechanical chain: hold, then the buttons
const RESET_WORDS = new Set(['0', 'menu', 'reset', 'قائمه', 'ابدا', 'ابدأ'].map((s) => s.toLowerCase()));

export interface TurnInput { inbound: InboundText; conversation: { id: string; phone: string; locale: string }; profile: ProfileRef | null; now?: Date }

/**
 * The assistant loop for ONE inbound message: sanitise, safety (emergency, human request, injection, medical advice), budgets, model step, validate, execute ONE tool at a time (at most 4 per message),
 * render from a fixed template, scan the output, send ONE outbound message. The model returns structured steps and never text for the patient; nothing here takes an identity from the message.
 */
@Injectable()
export class AssistantOrchestrator {
  private readonly log = new Logger('assistant');
  constructor(
    private readonly prisma: PrismaService, private readonly hub: MessagingHub, private readonly sessions: AssistantSessionService, private readonly tools: AssistantTools,
    private readonly confirms: ConfirmationStore, private readonly escalations: AssistantEscalationService, private readonly cost: AssistantCostService, private readonly audit: AssistantAudit,
    private readonly policies: AssistantPolicyService, private readonly models: AssistantModelFactory, private readonly booking: BookingService, private readonly catalog: CatalogService,
  ) {}

  /** One conversation turn, answered in the conversation's market (currency, minor units and time zone of the reply come from the registry; the default market is unchanged). */
  turn(i: TurnInput): Promise<RouteDecision> { return inConversationMarket(i.profile?.market ?? DEFAULT_MARKET, () => this.turnInMarket(i)); }

  private async turnInMarket(i: TurnInput): Promise<RouteDecision> {
    const t0 = Date.now(); const now = i.now ?? new Date();
    const market = i.profile?.market ?? DEFAULT_MARKET; const sub = i.profile?.sub ?? null; const verified = !!sub; const phone = i.conversation.phone;
    const policy = await this.policies.get(market);
    const loaded = await this.sessions.load({ conversationId: i.conversation.id, phone, sub, market, language: i.conversation.locale === 'en' ? 'en' : 'ar', now });
    const { session } = loaded; let ctx = loaded.ctx;
    if (loaded.expiredPrevious?.pendingHold && sub) await this.booking.release(sub, loaded.expiredPrevious.pendingHold.bookingId).catch(() => undefined); // holds are released when a session expires
    const seq = session.turns + 1;

    // ── 0. input hygiene ──
    const clean = sanitiseInbound(i.inbound.text, LIMITS.maxInboundChars);
    const button = parseButton(i.inbound.buttonPayload);
    let lang: Lang = detectLang(clean.text, session.language === 'en' ? 'en' : 'ar');
    let dialect: Dialect = detectDialect(clean.text, lang, ctx.dialect);
    const finish = (r: Rendered, o: { state?: SessionState; intent?: string; outcome?: string; tokens?: { in: number; out: number; cost: number }; tool?: string; mode?: string; silent?: boolean } = {}) => this.finish({ session, ctx, i, r, lang, dialect, seq, t0, now, policy, market, sub, ...o });

    const rawLen = (i.inbound.text ?? '').length;
    const hasContent = clean.text.length > 0 || !!i.inbound.buttonPayload;
    if (!hasContent) return finish(R.media(dialect), { outcome: 'MEDIA' });
    if (rawLen > LIMITS.maxInboundChars) return finish(R.tooLong(dialect), { outcome: 'TOO_LONG' });

    // a webhook retry (same provider message id) or the same text in the same context inside the window is answered once; the same words in a NEW context (a second "1") are a new message
    const h = sha(`${clean.text}|${i.inbound.buttonPayload ?? ''}|${session.state}|${ctx.shown.lastList ?? ''}|${ctx.shown.slots.length}|${ctx.shown.providers.length}`);
    const retry = !!i.inbound.providerRef && ctx.lastProviderRef === i.inbound.providerRef;
    if (retry || (!i.inbound.providerRef && !button && ctx.lastInboundHash === h && ctx.lastInboundAt && now.getTime() - ctx.lastInboundAt < LIMITS.dedupeWindowMs)) { await this.audit.record('dedupe', session.id, { outcome: 'DUPLICATE' }); return 'HANDLED'; }
    ctx.lastInboundHash = h; ctx.lastInboundAt = now.getTime(); ctx.lastProviderRef = i.inbound.providerRef;

    const inTurn = await this.sessions.addTurn({ sessionId: session.id, seq, direction: 'IN', redactedText: button ? '[BUTTON]' : redactForStorage(clean.text), retentionDays: policy.retentionDays });
    await this.sessions.save(session.id, { turnsIncrement: true, ctx, language: lang }, now);

    // ── 1. silent while a human has the conversation ──
    if (session.state === 'HANDOFF' && (await this.escalations.isOpen(session.id))) { await this.audit.record('silent_handoff', session.id, { state: 'HANDOFF' }); return 'HANDLED'; }

    // ── 2. SAFETY FIRST (never a flag): emergency pre-empts everything, before any model call ──
    const screen = screenInbound(clean.text);
    if (screen.emergency || detectEmergency(i.inbound.text).emergency) {
      await this.dropHold(session.id, sub, ctx);
      await this.audit.record('emergency', session.id, { outcome: 'EMERGENCY', signals: screen.emergencyCategories.slice(0, 3) });
      await this.catalog.track('emergency_guidance_shown', { code: screen.emergencyCategories[0] }).catch(() => undefined); // same analytics event as the machine: category code only, never the text
      return finish(R.emergency(dialect), { state: 'GREETING', outcome: 'EMERGENCY' });
    }
    // an expired hold is forgotten before anything else uses it
    if (ctx.pendingHold?.expiresAt && new Date(ctx.pendingHold.expiresAt) <= now) { await this.confirms.revokeFor(session.id, ctx.pendingHold.bookingId); ctx.pendingHold = undefined; }
    const state: SessionState = (session.state === 'START' ? 'GREETING' : session.state) as SessionState;
    const base = { session, ctx, i, lang, dialect, now, policy, market, sub, verified, phone, seq, t0, state, inTurnId: inTurn.id };

    // ── 3. the Confirm / Cancel buttons: executed by code from the exact payload, never by the model ──
    if (button) return this.runButton({ ...base, button }, finish);

    if (RESET_WORDS.has(clean.text.trim().toLowerCase())) { await this.dropHold(session.id, sub, ctx); ctx = this.freshCtx(ctx); return finish(R.greet(dialect), { state: 'GREETING', intent: 'reset' }); }
    if (screen.handoff) return this.escalate(base, 'USER_REQUEST', finish);
    if (screen.injection.length) { await this.audit.record('injection_suspected', session.id, { signals: screen.injection.slice(0, 5), outcome: 'REFUSED' }); return finish(R.refuse(dialect), { outcome: 'INJECTION_REFUSED' }); }
    if (asksMedicalAdvice(clean.text)) {
      await this.audit.record('medical_advice_request', session.id, { outcome: 'REDIRECTED' });
      this.askSpecialtyCtx(ctx);
      return finish({ key: 'medical_redirect', body: `${R.medicalRedirect(dialect).body}\n${R.askSpecialty(dialect, SHOWN_SPECIALTY_CODES).body}` }, { outcome: 'MEDICAL_REDIRECT' }); // fixed referral text, no model
    }

    // ── 4. the model loop ──
    return this.modelLoop({ ...base, clean: clean.text, finish });
  }

  // ───────────── model loop ─────────────
  private async modelLoop(b: any): Promise<RouteDecision> {
    const { session, ctx, policy, market, sub, verified, phone, now, state: startState, inTurnId, finish } = b as { session: any; ctx: SessionContext; policy: AssistantPolicy; market: string; sub: string | null; verified: boolean; phone: string; now: Date; state: SessionState; inTurnId: string; finish: any };
    let { lang, dialect } = b as { lang: Lang; dialect: Dialect };
    const chain = await this.models.get(policy, market);
    const text = redactForModel(b.clean as string);
    const named = namedSpecialties(b.clean as string, ctx.shown.specialties);
    const allowedUrls = new Set<string>();
    const today = marketDate(now);
    let state = startState; const toolResults: ToolResult[] = []; let last: (ToolOutcome & { args: Record<string, any> }) | null = null;
    let tokens = { in: 0, out: 0, cost: 0 }; let toolSteps = 0; let modelMode = chain.mode;

    for (let guard = 0; guard < LIMITS.maxToolSteps + 2; guard++) {
      const allowed = allowedTools(state, verified, policy.toolsByState);
      const input: ModelInput = {
        text, lang, dialect, state, verified, shown: ctx.shown, allowedTools: allowed, toolResults, rememberedSpecialty: ctx.specialty, today, turn: session.turns,
        prompt: { system: OpenAiCompatAssistantModel.systemPrompt(), user: `${wrapUserField(text)}\n${JSON.stringify({ s: state, d: today, allowed, list: ctx.shown.lastList ?? null, p: ctx.shown.providers.map((x) => x.id), t: ctx.shown.slots.map((x) => x.startsAt), b: ctx.shown.bookings.map((x) => x.id), sp: ctx.specialty ?? null, r: toolResults.map((r) => `${r.tool}:${r.ok ? 'ok' : r.code}`) })}` },
      };
      let raw: ModelStep;
      try { raw = await chain.step(input); }
      catch (e) {
        await this.audit.record('model_failed', session.id, { outcome: e instanceof ModelUnavailableError ? 'UNAVAILABLE' : 'ERROR', mode: chain.mode });
        await this.persist(session.id, ctx, state);
        return 'DETERMINISTIC'; // any model failure: the deterministic machine answers, the session and its holds are intact
      }
      const u = chain.lastUsage(); modelMode = chain.mode;
      tokens = { in: tokens.in + u.tokensIn, out: tokens.out + u.tokensOut, cost: tokens.cost + u.costMinor };
      await this.audit.record('model_step', session.id, { mode: chain.mode, model: chain.name.slice(0, 60), tokensIn: u.tokensIn, tokensOut: u.tokensOut, costMinor: u.costMinor, step: guard });
      if (tokens.in + tokens.out > policy.budgets.tokensPerTurn) { await this.audit.record('turn_budget', session.id, { outcome: 'TURN_CAP' }); await this.record(session.id, market, tokens, policy, b.seq === 1); await this.persist(session.id, ctx, state); return 'DETERMINISTIC'; }

      const step = validateModelStep(raw);
      if (!step) {
        ctx.invalidSteps = (ctx.invalidSteps ?? 0) + 1;
        await this.audit.record('model_invalid_step', session.id, { outcome: 'INVALID', count: ctx.invalidSteps });
        if (ctx.invalidSteps >= 2) { ctx.invalidSteps = 0; await this.record(session.id, market, tokens, policy, b.seq === 1); await this.persist(session.id, ctx, state); return 'DETERMINISTIC'; } // invalid becomes clarify once, then the deterministic path
        return this.reply({ ...b, ctx, state, tokens, modelMode, lastTool: undefined }, R.clarify(dialect, 'any'), 'CLARIFY_INVALID');
      }
      ctx.invalidSteps = 0;

      if (step.kind === 'handoff') return this.escalate({ ...b, state, tokens }, 'MODEL_HANDOFF', finish);
      if (step.kind === 'clarify') {
        ctx.clarifyFails += 1;
        if (ctx.clarifyFails >= LIMITS.clarifyFailuresBeforeHandoff) return this.escalate({ ...b, state, tokens }, 'CLARIFY_FAILED', finish);
        const r = step.slot === 'specialty' ? R.askSpecialty(dialect, SHOWN_SPECIALTY_CODES) : R.clarify(dialect, step.slot);
        if (step.slot === 'specialty') this.askSpecialtyCtx(ctx);
        return this.reply({ ...b, ctx, state, tokens, modelMode }, r, 'CLARIFY');
      }
      if (step.kind === 'reply_intent') {
        ctx.clarifyFails = 0;
        const fromTool = toolResults.length && last ? this.renderTool(last, ctx, dialect, allowedUrls) : null;
        const r = fromTool ?? reply(step.intent, dialect);
        if (!fromTool && (step.intent === 'symptom_choose_specialty' || step.intent === 'ask_specialty')) this.askSpecialtyCtx(ctx);
        return this.reply({ ...b, ctx, state, tokens, modelMode, lastTool: last?.tool, allowedUrls }, r, last ? 'TOOL' : step.intent.toUpperCase());
      }

      // ── a tool step: policy first, then validation, ids, ownership inside the tool ──
      if (!(allowed as readonly string[]).includes(step.tool) || toolSteps >= LIMITS.maxToolSteps) {
        await this.audit.record('tool_denied', session.id, { tool: step.tool, state, outcome: 'POLICY_DENIED' });
        ctx.clarifyFails += 1;
        if (ctx.clarifyFails >= LIMITS.clarifyFailuresBeforeHandoff) return this.escalate({ ...b, state, tokens }, 'CLARIFY_FAILED', finish);
        return this.reply({ ...b, ctx, state, tokens, modelMode }, R.clarify(dialect, 'any'), 'POLICY_DENIED');
      }
      toolSteps++;
      const tc: ToolContext = { sessionId: session.id, market, sub, phoneHash: phoneHashOf(phone), verified, lang, dialect, state, ctx, policy, named, button: null, now, today, allowedUrls };
      const out = await this.tools.run(step.tool, step.args, tc);
      last = out; toolResults.push({ tool: out.tool, ok: out.ok, code: out.code, data: out.data });
      await this.sessions.addToolCall({ turnId: inTurnId, tool: out.tool, argsRedacted: redactToolArgs(out.args), resultKind: out.ok ? 'OK' : out.code ?? 'ERROR', resultRef: this.refOf(out), confirmNonceHash: out.confirmNonceHash });
      await this.audit.record('tool_call', session.id, { tool: out.tool, outcome: out.ok ? 'OK' : out.code, nonceHash: out.confirmNonceHash, state });
      if (out.ok) ctx.clarifyFails = 0;
      if (out.state) state = out.state;
      if (out.handoff) return this.escalate({ ...b, state, tokens }, 'MODEL_HANDOFF', finish);
      if (out.end) { await this.dropHold(session.id, sub, ctx); return this.reply({ ...b, ctx, state: 'CLOSED', tokens, modelMode }, R.thanks(dialect), 'END'); }
      const mechanical = CONTINUE_AFTER.has(out.tool) && out.ok || (out.tool === 'get_my_bookings' && out.ok && out.data?.count === 1 && out.data?.purpose !== 'list');
      if (!mechanical || !out.ok) return this.reply({ ...b, ctx, state, tokens, modelMode, lastTool: out.tool, allowedUrls }, this.renderTool(out, ctx, dialect, allowedUrls), out.ok ? 'TOOL' : `TOOL_${out.code}`);
    }
    return this.reply({ ...b, ctx, state, tokens, modelMode, allowedUrls }, last ? this.renderTool(last, ctx, dialect, allowedUrls) : R.clarify(dialect, 'any'), 'LOOP_END');
  }

  // ───────────── buttons ─────────────
  private async runButton(b: any, finish: any): Promise<RouteDecision> {
    const { session, ctx, sub, verified, phone, now, policy, market, lang, dialect, button, state, inTurnId } = b;
    if (!verified) return finish(R.invalidConfirm(dialect), { outcome: 'BUTTON_UNVERIFIED' });
    const tc: ToolContext = { sessionId: session.id, market, sub, phoneHash: phoneHashOf(phone), verified, lang, dialect, state, ctx, policy, named: [], button, now, today: marketDate(now), allowedUrls: new Set() };
    const out = await this.tools.run('confirm_booking', {}, tc);
    await this.sessions.addToolCall({ turnId: inTurnId, tool: 'confirm_booking', argsRedacted: {}, resultKind: out.ok ? `OK:${out.data?.kind ?? ''}${out.data?.declined ? ':DECLINED' : ''}` : out.code ?? 'ERROR', resultRef: this.refOf(out), confirmNonceHash: sha(button.nonce) });
    await this.audit.record('tool_call', session.id, { tool: 'confirm_booking', outcome: out.ok ? 'OK' : out.code, nonceHash: sha(button.nonce), state });
    return this.reply({ ...b, ctx, state: out.state ?? state, tokens: { in: 0, out: 0, cost: 0 }, modelMode: 'mock', lastTool: 'confirm_booking', allowedUrls: tc.allowedUrls }, this.renderTool(out, ctx, dialect, tc.allowedUrls), out.ok ? 'BUTTON' : `BUTTON_${out.code}`);
  }

  // ───────────── rendering of tool results (all text from tool output) ─────────────
  private renderTool(o: ToolOutcome, ctx: SessionContext, d: Dialect, _urls: Set<string>): Rendered {
    const x = (o.data ?? {}) as Record<string, any>;
    if (!o.ok) {
      switch (o.code) {
        case 'SLOT_TAKEN': return this.withSlots(R.slotTaken(d), ctx, d);
        case 'HOLD_EXPIRED': return this.withSlots(R.holdExpired(d), ctx, d);
        case 'BUSY': return R.busy(d);
        case 'NOT_VERIFIED': return R.unverified(d);
        case 'NOT_BUTTON': return R.useButtons(d);
        case 'ALREADY_DONE': return R.alreadyDone(d, ({ BOOK: { en: 'booking', ar: 'الحجز' }, CANCEL: { en: 'cancellation', ar: 'الإلغاء' }, RESCHEDULE: { en: 'reschedule', ar: 'تغيير الموعد' } } as any)[x.kind]?.[d === 'en' ? 'en' : 'ar'] ?? '');
        case 'CONFIRM_INVALID': case 'CONFIRM_EXPIRED': return R.invalidConfirm(d);
        case 'CANCELLATION_WINDOW_CLOSED': return R.cancelWindowClosed(d);
        case 'WAITLIST_UNAVAILABLE': return R.waitlistUnavailable(d);
        case 'SPECIALTY_NOT_NAMED': case 'SPECIALTY_REQUIRED': this.askSpecialtyCtx(ctx); return R.askSpecialty(d, SHOWN_SPECIALTY_CODES);
        case 'NOT_CHANGEABLE': return R.noBookings(d);
        default: return R.clarify(d, 'any');
      }
    }
    switch (o.tool) {
      case 'search_providers': case 'get_next_available': return x.providers?.length ? R.providers(d, x.providers.map((p: any) => ({ name: d === 'en' ? p.nameEn ?? p.name : p.nameAr ?? p.name, feeMinor: p.feeMinor, currency: p.currency, nextSlotAt: p.nextSlotAt })), { areaRelaxed: x.areaRelaxed }) : R.noProviders(d);
      case 'get_slots': return x.slots?.length ? R.slots(d, x.doctor, x.slots) : R.noSlots(d, !!x.canWaitlist);
      case 'hold_slot': return R.confirmPrompt(d, { doctor: x.doctor, startsAt: x.startsAt, feeMinor: x.feeMinor, currency: x.currency, depositMinor: x.depositMinor }, '', ''); // never reached alone: prepare_confirmation follows
      case 'prepare_confirmation': return R.confirmPrompt(d, x as any, x.confirmId, x.declineId);
      case 'cancel_booking': return R.cancelPrompt(d, x as any, x.confirmId, x.declineId);
      case 'reschedule_booking': return R.reschedulePrompt(d, x as any, x.confirmId, x.declineId);
      case 'get_my_bookings': return x.bookings?.length ? R.bookings(d, x.bookings, x.purpose) : R.noBookings(d);
      case 'join_waitlist': return R.waitlisted(d);
      case 'create_booking_link': return R.link(d, x.url, x.intent);
      case 'confirm_booking':
        if (x.declined) return R.declined(d);
        if (x.kind === 'BOOK') return R.confirmed(d, x as any);
        if (x.kind === 'CANCEL') return R.cancelled(d);
        return R.rescheduled(d, x as any);
      default: return R.clarify(d, 'any');
    }
  }
  private withSlots(r: Rendered, ctx: SessionContext, d: Dialect): Rendered {
    if (!ctx.shown.slots.length) return r;
    const s = R.slots(d, ctx.doctor ?? '', ctx.shown.slots);
    return { key: r.key, body: `${r.body}\n${s.body}` };
  }
  private askSpecialtyCtx(ctx: SessionContext) { ctx.shown = { ...ctx.shown, specialties: [...SHOWN_SPECIALTY_CODES], lastList: 'specialties', providers: [], slots: [] }; return {}; }
  private refOf(o: ToolOutcome) { return o.resultRef ?? (o.data?.holdId as string | undefined) ?? (o.data?.url ? 'link' : undefined); }
  private freshCtx(ctx: SessionContext): SessionContext { return { ...ctx, shown: { providers: [], slots: [], bookings: [], specialties: [], lastList: null }, specialty: undefined, providerId: undefined, typeId: undefined, doctor: undefined, pendingHold: undefined, target: undefined, waitlistOffer: undefined, clarifyFails: 0, idsSeen: [] }; }

  private async dropHold(sessionId: string, sub: string | null, ctx: SessionContext) {
    if (ctx.pendingHold && sub) await this.booking.release(sub, ctx.pendingHold.bookingId).catch(() => undefined);
    await this.confirms.revokeAllPending(sessionId);
    ctx.pendingHold = undefined; ctx.target = undefined;
  }

  private async escalate(b: any, reason: string, finish: any): Promise<RouteDecision> {
    const { session, sub, ctx, policy } = b;
    await this.dropHold(session.id, sub, ctx);
    await this.escalations.open({ sessionId: session.id, reason, slaMinutes: policy.escalationSlaMinutes, now: b.now });
    await this.sessions.save(session.id, { state: 'HANDOFF', escalatedAt: new Date() });
    return finish(R.handoff(b.dialect, policy.escalationSlaMinutes), { state: 'HANDOFF', intent: 'handoff', outcome: 'HANDOFF' });
  }

  private async persist(sessionId: string, ctx: SessionContext, state: SessionState) { await this.sessions.save(sessionId, { ctx, state }); }
  private async record(sessionId: string, market: string, t: { in: number; out: number; cost: number }, policy: AssistantPolicy, firstTurn: boolean) {
    await this.cost.record({ market, sessionId, tokens: t.in + t.out, costMinor: t.cost, newConversation: firstTurn, policy });
  }

  /** Reply helper for the model loop and buttons: saves state, records usage and sends. */
  private async reply(b: any, r: Rendered, outcome: string): Promise<RouteDecision> {
    return this.finish({ session: b.session, ctx: b.ctx, i: b.i, r, lang: b.lang, dialect: b.dialect, seq: b.seq, t0: b.t0, now: b.now, policy: b.policy, market: b.market, sub: b.sub, state: b.state, outcome, tokens: b.tokens, tool: b.lastTool, mode: b.modelMode, allowedUrls: b.allowedUrls });
  }

  private async finish(o: { session: any; ctx: SessionContext; i: TurnInput; r: Rendered; lang: Lang; dialect: Dialect; seq: number; t0: number; now: Date; policy: AssistantPolicy; market: string; sub: string | null; state?: SessionState; intent?: string; outcome?: string; tokens?: { in: number; out: number; cost: number }; tool?: string; mode?: string; silent?: boolean; allowedUrls?: Set<string> }): Promise<RouteDecision> {
    const { session, ctx, i } = o;
    let r = o.r;
    // output scanner: fixed referral text replaces anything that reads as medical advice or a prompt leak; only create_booking_link URLs survive
    const scanned = scanOutbound(r.body, o.allowedUrls ?? new Set());
    if (scanned.blocked) { await this.audit.record('output_blocked', session.id, { outcome: scanned.blocked }); r = R.medicalRedirect(o.dialect); }
    else if (scanned.urlsStripped) { await this.audit.record('output_url_stripped', session.id, { count: scanned.urlsStripped }); r = { ...r, body: scanned.text }; }
    let body = r.body;
    if (!ctx.disclosed && r.key !== 'emergency') { body = `${R.disclosure(o.dialect)}\n${body}`; ctx.dialect = o.dialect; ctx.disclosed = true; }
    ctx.dialect = o.dialect;
    // MOCK dev inbox only: the interactive buttons are listed as text with their payloads so a tester (and the e2e suite) can press them. A real adapter renders `data.buttons` as interactive reply buttons
    // (Meta interactive messages: NEEDS_HUMAN go-live item); nothing is appended in real mode.
    if (r.buttons?.length && this.hub.adapter('WHATSAPP').mode === 'mock') body += `\n${r.buttons.map((x) => `[${x.title}] ${x.id}`).join('\n')}`;
    const state = o.state ?? (session.state as SessionState);
    await this.sessions.save(session.id, { state: state === ('START' as never) ? 'GREETING' : state, ctx, language: o.lang }, o.now);
    const t = o.tokens ?? { in: 0, out: 0, cost: 0 };
    if (t.in + t.out > 0 || t.cost > 0) await this.record(session.id, o.market, t, o.policy, o.seq === 1);
    if (t.in + t.out > 0 && o.sub) await this.prisma.aiUsage.create({ data: { sub: o.sub, purpose: 'whatsapp_assistant', provider: o.mode === 'real' ? 'assistant-real' : 'assistant-mock', promptVersion: 'assistant-v1', redactions: 0, source: o.mode === 'real' ? 'AI' : 'RULES' } }).catch(() => undefined);
    await this.sessions.addTurn({ sessionId: session.id, seq: o.seq, direction: 'OUT', intent: r.key, toolName: o.tool, modelMode: o.mode ?? 'mock', tokensIn: t.in, tokensOut: t.out, costMinor: t.cost, latencyMs: Date.now() - o.t0, outcome: o.outcome ?? 'OK', retentionDays: o.policy.retentionDays });
    await this.hub.send({ channel: 'WHATSAPP', sub: o.sub ?? undefined, to: i.conversation.phone, templateId: templateId(r.key), locale: o.lang, body, conversational: true, ...(r.buttons?.length ? { data: { buttons: r.buttons } } : {}) });
    return 'HANDLED';
  }
}
