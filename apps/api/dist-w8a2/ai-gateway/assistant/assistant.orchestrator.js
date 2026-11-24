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
exports.AssistantOrchestrator = exports.templateId = void 0;
const market_core_public_1 = require("../../market/market-core-public");
const common_1 = require("@nestjs/common");
const booking_public_1 = require("../../booking/booking-public");
const catalog_public_1 = require("../../catalog/catalog-public");
const messaging_public_1 = require("../../messaging/messaging-public");
const prisma_service_1 = require("../../prisma/prisma.service");
const safety_public_1 = require("../../safety/safety-public");
const assistant_audit_1 = require("./assistant.audit");
const assistant_config_1 = require("./assistant.config");
const assistant_confirm_1 = require("./assistant.confirm");
const assistant_cost_service_1 = require("./assistant.cost.service");
const assistant_escalation_service_1 = require("./assistant.escalation.service");
const assistant_lexicon_1 = require("./assistant.lexicon");
const assistant_model_factory_1 = require("./assistant.model.factory");
const assistant_model_port_1 = require("./assistant.model.port");
const assistant_policy_1 = require("./assistant.policy");
const assistant_render_1 = require("./assistant.render");
const assistant_safety_1 = require("./assistant.safety");
const assistant_session_service_1 = require("./assistant.session.service");
const assistant_tools_1 = require("./assistant.tools");
const openai_compat_model_1 = require("./model/openai-compat.model");
const fallback_chain_1 = require("./model/fallback.chain");
const templateId = (key) => `TODO_NEEDS_HUMAN_wa_assistant_${key}`;
exports.templateId = templateId;
const CONTINUE_AFTER = new Set(['hold_slot']);
const RESET_WORDS = new Set(['0', 'menu', 'reset', 'قائمه', 'ابدا', 'ابدأ'].map((s) => s.toLowerCase()));
let AssistantOrchestrator = class AssistantOrchestrator {
    prisma;
    hub;
    sessions;
    tools;
    confirms;
    escalations;
    cost;
    audit;
    policies;
    models;
    booking;
    catalog;
    log = new common_1.Logger('assistant');
    constructor(prisma, hub, sessions, tools, confirms, escalations, cost, audit, policies, models, booking, catalog) {
        this.prisma = prisma;
        this.hub = hub;
        this.sessions = sessions;
        this.tools = tools;
        this.confirms = confirms;
        this.escalations = escalations;
        this.cost = cost;
        this.audit = audit;
        this.policies = policies;
        this.models = models;
        this.booking = booking;
        this.catalog = catalog;
    }
    async turn(i) {
        const t0 = Date.now();
        const now = i.now ?? new Date();
        const market = i.profile?.market ?? market_core_public_1.DEFAULT_MARKET;
        const sub = i.profile?.sub ?? null;
        const verified = !!sub;
        const phone = i.conversation.phone;
        const policy = await this.policies.get(market);
        const loaded = await this.sessions.load({ conversationId: i.conversation.id, phone, sub, market, language: i.conversation.locale === 'en' ? 'en' : 'ar', now });
        const { session } = loaded;
        let ctx = loaded.ctx;
        if (loaded.expiredPrevious?.pendingHold && sub)
            await this.booking.release(sub, loaded.expiredPrevious.pendingHold.bookingId).catch(() => undefined);
        const seq = session.turns + 1;
        const clean = (0, assistant_safety_1.sanitiseInbound)(i.inbound.text, assistant_policy_1.LIMITS.maxInboundChars);
        const button = (0, assistant_confirm_1.parseButton)(i.inbound.buttonPayload);
        let lang = (0, assistant_lexicon_1.detectLang)(clean.text, session.language === 'en' ? 'en' : 'ar');
        let dialect = (0, assistant_lexicon_1.detectDialect)(clean.text, lang, ctx.dialect);
        const finish = (r, o = {}) => this.finish({ session, ctx, i, r, lang, dialect, seq, t0, now, policy, market, sub, ...o });
        const rawLen = (i.inbound.text ?? '').length;
        const hasContent = clean.text.length > 0 || !!i.inbound.buttonPayload;
        if (!hasContent)
            return finish(assistant_render_1.R.media(dialect), { outcome: 'MEDIA' });
        if (rawLen > assistant_policy_1.LIMITS.maxInboundChars)
            return finish(assistant_render_1.R.tooLong(dialect), { outcome: 'TOO_LONG' });
        const h = (0, assistant_audit_1.sha)(`${clean.text}|${i.inbound.buttonPayload ?? ''}|${session.state}|${ctx.shown.lastList ?? ''}|${ctx.shown.slots.length}|${ctx.shown.providers.length}`);
        const retry = !!i.inbound.providerRef && ctx.lastProviderRef === i.inbound.providerRef;
        if (retry || (!i.inbound.providerRef && !button && ctx.lastInboundHash === h && ctx.lastInboundAt && now.getTime() - ctx.lastInboundAt < assistant_policy_1.LIMITS.dedupeWindowMs)) {
            await this.audit.record('dedupe', session.id, { outcome: 'DUPLICATE' });
            return 'HANDLED';
        }
        ctx.lastInboundHash = h;
        ctx.lastInboundAt = now.getTime();
        ctx.lastProviderRef = i.inbound.providerRef;
        const inTurn = await this.sessions.addTurn({ sessionId: session.id, seq, direction: 'IN', redactedText: button ? '[BUTTON]' : (0, assistant_safety_1.redactForStorage)(clean.text), retentionDays: policy.retentionDays });
        await this.sessions.save(session.id, { turnsIncrement: true, ctx, language: lang }, now);
        if (session.state === 'HANDOFF' && (await this.escalations.isOpen(session.id))) {
            await this.audit.record('silent_handoff', session.id, { state: 'HANDOFF' });
            return 'HANDLED';
        }
        const screen = (0, assistant_safety_1.screenInbound)(clean.text);
        if (screen.emergency || (0, safety_public_1.detectEmergency)(i.inbound.text).emergency) {
            await this.dropHold(session.id, sub, ctx);
            await this.audit.record('emergency', session.id, { outcome: 'EMERGENCY', signals: screen.emergencyCategories.slice(0, 3) });
            await this.catalog.track('emergency_guidance_shown', { code: screen.emergencyCategories[0] }).catch(() => undefined);
            return finish(assistant_render_1.R.emergency(dialect), { state: 'GREETING', outcome: 'EMERGENCY' });
        }
        if (ctx.pendingHold?.expiresAt && new Date(ctx.pendingHold.expiresAt) <= now) {
            await this.confirms.revokeFor(session.id, ctx.pendingHold.bookingId);
            ctx.pendingHold = undefined;
        }
        const state = (session.state === 'START' ? 'GREETING' : session.state);
        const base = { session, ctx, i, lang, dialect, now, policy, market, sub, verified, phone, seq, t0, state, inTurnId: inTurn.id };
        if (button)
            return this.runButton({ ...base, button }, finish);
        if (RESET_WORDS.has(clean.text.trim().toLowerCase())) {
            await this.dropHold(session.id, sub, ctx);
            ctx = this.freshCtx(ctx);
            return finish(assistant_render_1.R.greet(dialect), { state: 'GREETING', intent: 'reset' });
        }
        if (screen.handoff)
            return this.escalate(base, 'USER_REQUEST', finish);
        if (screen.injection.length) {
            await this.audit.record('injection_suspected', session.id, { signals: screen.injection.slice(0, 5), outcome: 'REFUSED' });
            return finish(assistant_render_1.R.refuse(dialect), { outcome: 'INJECTION_REFUSED' });
        }
        if ((0, assistant_safety_1.asksMedicalAdvice)(clean.text)) {
            await this.audit.record('medical_advice_request', session.id, { outcome: 'REDIRECTED' });
            this.askSpecialtyCtx(ctx);
            return finish({ key: 'medical_redirect', body: `${assistant_render_1.R.medicalRedirect(dialect).body}\n${assistant_render_1.R.askSpecialty(dialect, assistant_render_1.SHOWN_SPECIALTY_CODES).body}` }, { outcome: 'MEDICAL_REDIRECT' });
        }
        return this.modelLoop({ ...base, clean: clean.text, finish });
    }
    async modelLoop(b) {
        const { session, ctx, policy, market, sub, verified, phone, now, state: startState, inTurnId, finish } = b;
        let { lang, dialect } = b;
        const chain = await this.models.get(policy, market);
        const text = (0, assistant_safety_1.redactForModel)(b.clean);
        const named = (0, assistant_lexicon_1.namedSpecialties)(b.clean, ctx.shown.specialties);
        const allowedUrls = new Set();
        const today = (0, assistant_lexicon_1.marketDate)(now);
        let state = startState;
        const toolResults = [];
        let last = null;
        let tokens = { in: 0, out: 0, cost: 0 };
        let toolSteps = 0;
        let modelMode = chain.mode;
        for (let guard = 0; guard < assistant_policy_1.LIMITS.maxToolSteps + 2; guard++) {
            const allowed = (0, assistant_policy_1.allowedTools)(state, verified, policy.toolsByState);
            const input = {
                text, lang, dialect, state, verified, shown: ctx.shown, allowedTools: allowed, toolResults, rememberedSpecialty: ctx.specialty, today, turn: session.turns,
                prompt: { system: openai_compat_model_1.OpenAiCompatAssistantModel.systemPrompt(), user: `${(0, assistant_safety_1.wrapUserField)(text)}\n${JSON.stringify({ s: state, d: today, allowed, list: ctx.shown.lastList ?? null, p: ctx.shown.providers.map((x) => x.id), t: ctx.shown.slots.map((x) => x.startsAt), b: ctx.shown.bookings.map((x) => x.id), sp: ctx.specialty ?? null, r: toolResults.map((r) => `${r.tool}:${r.ok ? 'ok' : r.code}`) })}` },
            };
            let raw;
            try {
                raw = await chain.step(input);
            }
            catch (e) {
                await this.audit.record('model_failed', session.id, { outcome: e instanceof fallback_chain_1.ModelUnavailableError ? 'UNAVAILABLE' : 'ERROR', mode: chain.mode });
                await this.persist(session.id, ctx, state);
                return 'DETERMINISTIC';
            }
            const u = chain.lastUsage();
            modelMode = chain.mode;
            tokens = { in: tokens.in + u.tokensIn, out: tokens.out + u.tokensOut, cost: tokens.cost + u.costMinor };
            await this.audit.record('model_step', session.id, { mode: chain.mode, model: chain.name.slice(0, 60), tokensIn: u.tokensIn, tokensOut: u.tokensOut, costMinor: u.costMinor, step: guard });
            if (tokens.in + tokens.out > policy.budgets.tokensPerTurn) {
                await this.audit.record('turn_budget', session.id, { outcome: 'TURN_CAP' });
                await this.record(session.id, market, tokens, policy, b.seq === 1);
                await this.persist(session.id, ctx, state);
                return 'DETERMINISTIC';
            }
            const step = (0, assistant_model_port_1.validateModelStep)(raw);
            if (!step) {
                ctx.invalidSteps = (ctx.invalidSteps ?? 0) + 1;
                await this.audit.record('model_invalid_step', session.id, { outcome: 'INVALID', count: ctx.invalidSteps });
                if (ctx.invalidSteps >= 2) {
                    ctx.invalidSteps = 0;
                    await this.record(session.id, market, tokens, policy, b.seq === 1);
                    await this.persist(session.id, ctx, state);
                    return 'DETERMINISTIC';
                }
                return this.reply({ ...b, ctx, state, tokens, modelMode, lastTool: undefined }, assistant_render_1.R.clarify(dialect, 'any'), 'CLARIFY_INVALID');
            }
            ctx.invalidSteps = 0;
            if (step.kind === 'handoff')
                return this.escalate({ ...b, state, tokens }, 'MODEL_HANDOFF', finish);
            if (step.kind === 'clarify') {
                ctx.clarifyFails += 1;
                if (ctx.clarifyFails >= assistant_policy_1.LIMITS.clarifyFailuresBeforeHandoff)
                    return this.escalate({ ...b, state, tokens }, 'CLARIFY_FAILED', finish);
                const r = step.slot === 'specialty' ? assistant_render_1.R.askSpecialty(dialect, assistant_render_1.SHOWN_SPECIALTY_CODES) : assistant_render_1.R.clarify(dialect, step.slot);
                if (step.slot === 'specialty')
                    this.askSpecialtyCtx(ctx);
                return this.reply({ ...b, ctx, state, tokens, modelMode }, r, 'CLARIFY');
            }
            if (step.kind === 'reply_intent') {
                ctx.clarifyFails = 0;
                const fromTool = toolResults.length && last ? this.renderTool(last, ctx, dialect, allowedUrls) : null;
                const r = fromTool ?? (0, assistant_render_1.reply)(step.intent, dialect);
                if (!fromTool && (step.intent === 'symptom_choose_specialty' || step.intent === 'ask_specialty'))
                    this.askSpecialtyCtx(ctx);
                return this.reply({ ...b, ctx, state, tokens, modelMode, lastTool: last?.tool, allowedUrls }, r, last ? 'TOOL' : step.intent.toUpperCase());
            }
            if (!allowed.includes(step.tool) || toolSteps >= assistant_policy_1.LIMITS.maxToolSteps) {
                await this.audit.record('tool_denied', session.id, { tool: step.tool, state, outcome: 'POLICY_DENIED' });
                ctx.clarifyFails += 1;
                if (ctx.clarifyFails >= assistant_policy_1.LIMITS.clarifyFailuresBeforeHandoff)
                    return this.escalate({ ...b, state, tokens }, 'CLARIFY_FAILED', finish);
                return this.reply({ ...b, ctx, state, tokens, modelMode }, assistant_render_1.R.clarify(dialect, 'any'), 'POLICY_DENIED');
            }
            toolSteps++;
            const tc = { sessionId: session.id, market, sub, phoneHash: (0, assistant_session_service_1.phoneHashOf)(phone), verified, lang, dialect, state, ctx, policy, named, button: null, now, today, allowedUrls };
            const out = await this.tools.run(step.tool, step.args, tc);
            last = out;
            toolResults.push({ tool: out.tool, ok: out.ok, code: out.code, data: out.data });
            await this.sessions.addToolCall({ turnId: inTurnId, tool: out.tool, argsRedacted: (0, assistant_audit_1.redactToolArgs)(out.args), resultKind: out.ok ? 'OK' : out.code ?? 'ERROR', resultRef: this.refOf(out), confirmNonceHash: out.confirmNonceHash });
            await this.audit.record('tool_call', session.id, { tool: out.tool, outcome: out.ok ? 'OK' : out.code, nonceHash: out.confirmNonceHash, state });
            if (out.ok)
                ctx.clarifyFails = 0;
            if (out.state)
                state = out.state;
            if (out.handoff)
                return this.escalate({ ...b, state, tokens }, 'MODEL_HANDOFF', finish);
            if (out.end) {
                await this.dropHold(session.id, sub, ctx);
                return this.reply({ ...b, ctx, state: 'CLOSED', tokens, modelMode }, assistant_render_1.R.thanks(dialect), 'END');
            }
            const mechanical = CONTINUE_AFTER.has(out.tool) && out.ok || (out.tool === 'get_my_bookings' && out.ok && out.data?.count === 1 && out.data?.purpose !== 'list');
            if (!mechanical || !out.ok)
                return this.reply({ ...b, ctx, state, tokens, modelMode, lastTool: out.tool, allowedUrls }, this.renderTool(out, ctx, dialect, allowedUrls), out.ok ? 'TOOL' : `TOOL_${out.code}`);
        }
        return this.reply({ ...b, ctx, state, tokens, modelMode, allowedUrls }, last ? this.renderTool(last, ctx, dialect, allowedUrls) : assistant_render_1.R.clarify(dialect, 'any'), 'LOOP_END');
    }
    async runButton(b, finish) {
        const { session, ctx, sub, verified, phone, now, policy, market, lang, dialect, button, state, inTurnId } = b;
        if (!verified)
            return finish(assistant_render_1.R.invalidConfirm(dialect), { outcome: 'BUTTON_UNVERIFIED' });
        const tc = { sessionId: session.id, market, sub, phoneHash: (0, assistant_session_service_1.phoneHashOf)(phone), verified, lang, dialect, state, ctx, policy, named: [], button, now, today: (0, assistant_lexicon_1.marketDate)(now), allowedUrls: new Set() };
        const out = await this.tools.run('confirm_booking', {}, tc);
        await this.sessions.addToolCall({ turnId: inTurnId, tool: 'confirm_booking', argsRedacted: {}, resultKind: out.ok ? `OK:${out.data?.kind ?? ''}${out.data?.declined ? ':DECLINED' : ''}` : out.code ?? 'ERROR', resultRef: this.refOf(out), confirmNonceHash: (0, assistant_audit_1.sha)(button.nonce) });
        await this.audit.record('tool_call', session.id, { tool: 'confirm_booking', outcome: out.ok ? 'OK' : out.code, nonceHash: (0, assistant_audit_1.sha)(button.nonce), state });
        return this.reply({ ...b, ctx, state: out.state ?? state, tokens: { in: 0, out: 0, cost: 0 }, modelMode: 'mock', lastTool: 'confirm_booking', allowedUrls: tc.allowedUrls }, this.renderTool(out, ctx, dialect, tc.allowedUrls), out.ok ? 'BUTTON' : `BUTTON_${out.code}`);
    }
    renderTool(o, ctx, d, _urls) {
        const x = (o.data ?? {});
        if (!o.ok) {
            switch (o.code) {
                case 'SLOT_TAKEN': return this.withSlots(assistant_render_1.R.slotTaken(d), ctx, d);
                case 'HOLD_EXPIRED': return this.withSlots(assistant_render_1.R.holdExpired(d), ctx, d);
                case 'BUSY': return assistant_render_1.R.busy(d);
                case 'NOT_VERIFIED': return assistant_render_1.R.unverified(d);
                case 'NOT_BUTTON': return assistant_render_1.R.useButtons(d);
                case 'ALREADY_DONE': return assistant_render_1.R.alreadyDone(d, { BOOK: { en: 'booking', ar: 'الحجز' }, CANCEL: { en: 'cancellation', ar: 'الإلغاء' }, RESCHEDULE: { en: 'reschedule', ar: 'تغيير الموعد' } }[x.kind]?.[d === 'en' ? 'en' : 'ar'] ?? '');
                case 'CONFIRM_INVALID':
                case 'CONFIRM_EXPIRED': return assistant_render_1.R.invalidConfirm(d);
                case 'WAITLIST_UNAVAILABLE': return assistant_render_1.R.waitlistUnavailable(d);
                case 'SPECIALTY_NOT_NAMED':
                case 'SPECIALTY_REQUIRED':
                    this.askSpecialtyCtx(ctx);
                    return assistant_render_1.R.askSpecialty(d, assistant_render_1.SHOWN_SPECIALTY_CODES);
                case 'NOT_CHANGEABLE': return assistant_render_1.R.noBookings(d);
                default: return assistant_render_1.R.clarify(d, 'any');
            }
        }
        switch (o.tool) {
            case 'search_providers':
            case 'get_next_available': return x.providers?.length ? assistant_render_1.R.providers(d, x.providers.map((p) => ({ name: d === 'en' ? p.nameEn ?? p.name : p.nameAr ?? p.name, feeMinor: p.feeMinor, currency: p.currency, nextSlotAt: p.nextSlotAt })), { areaRelaxed: x.areaRelaxed }) : assistant_render_1.R.noProviders(d);
            case 'get_slots': return x.slots?.length ? assistant_render_1.R.slots(d, x.doctor, x.slots) : assistant_render_1.R.noSlots(d, !!x.canWaitlist);
            case 'hold_slot': return assistant_render_1.R.confirmPrompt(d, { doctor: x.doctor, startsAt: x.startsAt, feeMinor: x.feeMinor, currency: x.currency, depositMinor: x.depositMinor }, '', '');
            case 'prepare_confirmation': return assistant_render_1.R.confirmPrompt(d, x, x.confirmId, x.declineId);
            case 'cancel_booking': return assistant_render_1.R.cancelPrompt(d, x, x.confirmId, x.declineId);
            case 'reschedule_booking': return assistant_render_1.R.reschedulePrompt(d, x, x.confirmId, x.declineId);
            case 'get_my_bookings': return x.bookings?.length ? assistant_render_1.R.bookings(d, x.bookings, x.purpose) : assistant_render_1.R.noBookings(d);
            case 'join_waitlist': return assistant_render_1.R.waitlisted(d);
            case 'create_booking_link': return assistant_render_1.R.link(d, x.url, x.intent);
            case 'confirm_booking':
                if (x.declined)
                    return assistant_render_1.R.declined(d);
                if (x.kind === 'BOOK')
                    return assistant_render_1.R.confirmed(d, x);
                if (x.kind === 'CANCEL')
                    return assistant_render_1.R.cancelled(d);
                return assistant_render_1.R.rescheduled(d, x);
            default: return assistant_render_1.R.clarify(d, 'any');
        }
    }
    withSlots(r, ctx, d) {
        if (!ctx.shown.slots.length)
            return r;
        const s = assistant_render_1.R.slots(d, ctx.doctor ?? '', ctx.shown.slots);
        return { key: r.key, body: `${r.body}\n${s.body}` };
    }
    askSpecialtyCtx(ctx) { ctx.shown = { ...ctx.shown, specialties: [...assistant_render_1.SHOWN_SPECIALTY_CODES], lastList: 'specialties', providers: [], slots: [] }; return {}; }
    refOf(o) { return o.resultRef ?? o.data?.holdId ?? (o.data?.url ? 'link' : undefined); }
    freshCtx(ctx) { return { ...ctx, shown: { providers: [], slots: [], bookings: [], specialties: [], lastList: null }, specialty: undefined, providerId: undefined, typeId: undefined, doctor: undefined, pendingHold: undefined, target: undefined, waitlistOffer: undefined, clarifyFails: 0, idsSeen: [] }; }
    async dropHold(sessionId, sub, ctx) {
        if (ctx.pendingHold && sub)
            await this.booking.release(sub, ctx.pendingHold.bookingId).catch(() => undefined);
        await this.confirms.revokeAllPending(sessionId);
        ctx.pendingHold = undefined;
        ctx.target = undefined;
    }
    async escalate(b, reason, finish) {
        const { session, sub, ctx, policy } = b;
        await this.dropHold(session.id, sub, ctx);
        await this.escalations.open({ sessionId: session.id, reason, slaMinutes: policy.escalationSlaMinutes, now: b.now });
        await this.sessions.save(session.id, { state: 'HANDOFF', escalatedAt: new Date() });
        return finish(assistant_render_1.R.handoff(b.dialect, policy.escalationSlaMinutes), { state: 'HANDOFF', intent: 'handoff', outcome: 'HANDOFF' });
    }
    async persist(sessionId, ctx, state) { await this.sessions.save(sessionId, { ctx, state }); }
    async record(sessionId, market, t, policy, firstTurn) {
        await this.cost.record({ market, sessionId, tokens: t.in + t.out, costMinor: t.cost, newConversation: firstTurn, policy });
    }
    async reply(b, r, outcome) {
        return this.finish({ session: b.session, ctx: b.ctx, i: b.i, r, lang: b.lang, dialect: b.dialect, seq: b.seq, t0: b.t0, now: b.now, policy: b.policy, market: b.market, sub: b.sub, state: b.state, outcome, tokens: b.tokens, tool: b.lastTool, mode: b.modelMode, allowedUrls: b.allowedUrls });
    }
    async finish(o) {
        const { session, ctx, i } = o;
        let r = o.r;
        const scanned = (0, assistant_safety_1.scanOutbound)(r.body, o.allowedUrls ?? new Set());
        if (scanned.blocked) {
            await this.audit.record('output_blocked', session.id, { outcome: scanned.blocked });
            r = assistant_render_1.R.medicalRedirect(o.dialect);
        }
        else if (scanned.urlsStripped) {
            await this.audit.record('output_url_stripped', session.id, { count: scanned.urlsStripped });
            r = { ...r, body: scanned.text };
        }
        let body = r.body;
        if (!ctx.disclosed && r.key !== 'emergency') {
            body = `${assistant_render_1.R.disclosure(o.dialect)}\n${body}`;
            ctx.dialect = o.dialect;
            ctx.disclosed = true;
        }
        ctx.dialect = o.dialect;
        if (r.buttons?.length && this.hub.adapter('WHATSAPP').mode === 'mock')
            body += `\n${r.buttons.map((x) => `[${x.title}] ${x.id}`).join('\n')}`;
        const state = o.state ?? session.state;
        await this.sessions.save(session.id, { state: state === 'START' ? 'GREETING' : state, ctx, language: o.lang }, o.now);
        const t = o.tokens ?? { in: 0, out: 0, cost: 0 };
        if (t.in + t.out > 0 || t.cost > 0)
            await this.record(session.id, o.market, t, o.policy, o.seq === 1);
        if (t.in + t.out > 0 && o.sub)
            await this.prisma.aiUsage.create({ data: { sub: o.sub, purpose: 'whatsapp_assistant', provider: o.mode === 'real' ? 'assistant-real' : 'assistant-mock', promptVersion: 'assistant-v1', redactions: 0, source: o.mode === 'real' ? 'AI' : 'RULES' } }).catch(() => undefined);
        await this.sessions.addTurn({ sessionId: session.id, seq: o.seq, direction: 'OUT', intent: r.key, toolName: o.tool, modelMode: o.mode ?? 'mock', tokensIn: t.in, tokensOut: t.out, costMinor: t.cost, latencyMs: Date.now() - o.t0, outcome: o.outcome ?? 'OK', retentionDays: o.policy.retentionDays });
        await this.hub.send({ channel: 'WHATSAPP', sub: o.sub ?? undefined, to: i.conversation.phone, templateId: (0, exports.templateId)(r.key), locale: o.lang, body, ...(r.buttons?.length ? { data: { buttons: r.buttons } } : {}) });
        return 'HANDLED';
    }
};
exports.AssistantOrchestrator = AssistantOrchestrator;
exports.AssistantOrchestrator = AssistantOrchestrator = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, messaging_public_1.MessagingHub, assistant_session_service_1.AssistantSessionService, assistant_tools_1.AssistantTools,
        assistant_confirm_1.ConfirmationStore, assistant_escalation_service_1.AssistantEscalationService, assistant_cost_service_1.AssistantCostService, assistant_audit_1.AssistantAudit,
        assistant_config_1.AssistantPolicyService, assistant_model_factory_1.AssistantModelFactory, booking_public_1.BookingService, catalog_public_1.CatalogService])
], AssistantOrchestrator);
//# sourceMappingURL=assistant.orchestrator.js.map