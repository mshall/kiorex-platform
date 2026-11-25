import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Injectable, Logger } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { ASSISTANT_FLAG } from './assistant.growth-bridge';
import { PatientService } from '../../patient/patient-public';
import { PrismaService } from '../../prisma/prisma.service';
import { AssistantAudit } from './assistant.audit';
import { AssistantPolicyService } from './assistant.config';
import { AssistantCostService } from './assistant.cost.service';
import { AssistantLinkService } from './assistant.link.service';
import { AssistantModelFactory } from './assistant.model.factory';
import { AssistantOrchestrator, templateId } from './assistant.orchestrator';
import { AssistantRateLimit, ConcurrencyGate } from './assistant.rate-limit';
import { R } from './assistant.render';
import { isOptOut } from './assistant.safety';
import { AssistantSessionService, phoneHashOf } from './assistant.session.service';
import { detectDialect, detectLang } from './assistant.lexicon';
import { MessagingHub } from '../../messaging/messaging-public';
import type { ConversationRef, InboundText, ProfileRef, RouteDecision } from './assistant.types';

/**
 * The front stage `WhatsAppBookingService.handle` asks before its state machine (the ONLY edit to that file). `DETERMINISTIC` means "fall through unchanged": the machine answers exactly as it did
 * before this package existed. The assistant answers (`HANDLED`) only when ALL of these hold; any miss, any model failure, any unexpected error is `DETERMINISTIC`, so a booking is never blocked by the assistant:
 *  1 the locked flag `kiorex.whatsapp_ai_assistant` is effective in the market (gate evidence);  2 no deterministic flow is in progress for this conversation;
 *  3 the verified patient has the `AI_PROCESSING` consent (an unverified number is allowed only while the model runs inside the platform: mock or fixture);
 *  4 the budgets and the cost breaker allow it;  5 global concurrency has room;  6 the number is inside its hourly message rate.
 * Emergency language never reaches this point (the machine's safety step runs first) and is checked again inside the orchestrator.
 */
@Injectable()
export class AssistantRouter {
  private readonly log = new Logger('assistant-router');
  private readonly gate = new ConcurrencyGate();
  constructor(
    private readonly flags: FlagsService, private readonly patients: PatientService, private readonly prisma: PrismaService, private readonly orchestrator: AssistantOrchestrator, private readonly cost: AssistantCostService,
    private readonly policies: AssistantPolicyService, private readonly models: AssistantModelFactory, private readonly rate: AssistantRateLimit, private readonly audit: AssistantAudit, private readonly sessions: AssistantSessionService, private readonly hub: MessagingHub, private readonly links: AssistantLinkService,
  ) {}

  /** Once a week per number: a one-time link to the account page where the patient can allow AI processing (optional, withdrawable). Never sent for an unverified number. */
  private async inviteConsent(inbound: InboundText, conv: ConversationRef, profile: ProfileRef): Promise<void> {
    const ph = phoneHashOf(conv.phone);
    const once = await this.rate.limiter.hit(`assistant:consent-invite:${ph}`, 1, 7 * 24 * 3_600_000);
    if (!once.ok) return;
    const l = await this.links.create({ phoneHash: ph, intent: 'CONSENT' }); if (!l) return;
    const d = detectLang(inbound.text ?? '', conv.locale === 'en' ? 'en' : 'ar') === 'en' ? 'en' : detectDialect(inbound.text ?? '', 'ar');
    await this.hub.send({ channel: 'WHATSAPP', sub: profile.sub, to: conv.phone, templateId: templateId('consent_invite'), locale: d === 'en' ? 'en' : 'ar', body: R.consentInvite(d, l.url).body, conversational: true });
    await this.audit.record('consent_invite', null, { outcome: 'INVITED' });
  }

  async route(inbound: InboundText, conv: ConversationRef, profile: ProfileRef | null): Promise<RouteDecision> {
    const market = profile?.market ?? DEFAULT_MARKET;
    try {
      if (isOptOut(inbound.text)) return 'DETERMINISTIC'; // STOP is a legal opt-out handled by the machine, never by the assistant
      if (!(await this.flags.evaluate(ASSISTANT_FLAG.ASSISTANT, { market })).effective) return 'DETERMINISTIC';
      const now = new Date();
      const live = await this.prisma.assistantSession.findFirst({ where: { channelConversationId: conv.id, closedAt: null, expiresAt: { gt: now } } });
      if (conv.state !== 'IDLE' && !live) return 'DETERMINISTIC'; // never hijack a flow the deterministic machine started
      const policy = await this.policies.get(market);
      const model = await this.models.get(policy, market);
      if (profile) {
        if (!(await this.patients.hasConsent(profile.sub, 'AI_PROCESSING'))) {
          await this.audit.record('consent_missing', live?.id ?? null, { outcome: 'DETERMINISTIC', reason: 'NO_AI_CONSENT' });
          await this.inviteConsent(inbound, conv, profile).catch((e) => this.log.warn(`consent invite failed: ${(e as Error).message}`)); // an invite, never a switch: the deterministic machine still answers this message
          return 'DETERMINISTIC';
        }
      } else if (model.mode === 'real') return 'DETERMINISTIC'; // an unverified number's text never leaves the platform
      const sessionRef = live ?? { turns: 0, tokenBudgetUsed: 0 };
      const verdict = await this.cost.check({ market, sub: profile?.sub ?? null, session: sessionRef, policy, now });
      if (!verdict.ok) { await this.audit.record('budget_stop', live?.id ?? null, { outcome: 'DETERMINISTIC', reason: verdict.reason }); return 'DETERMINISTIC'; }
      const rl = await this.rate.perNumber(phoneHashOf(conv.phone), policy.rateLimits.messagesPerNumberPerHour);
      if (!rl.ok) {
        await this.audit.record('rate_limited', live?.id ?? null, { outcome: 'RATE_LIMITED' });
        if (rl.notify) { const d = detectLang(inbound.text ?? '', conv.locale === 'en' ? 'en' : 'ar') === 'en' ? 'en' : detectDialect(inbound.text ?? '', 'ar'); await this.hub.send({ channel: 'WHATSAPP', sub: profile?.sub, to: conv.phone, templateId: templateId('rate_limited'), locale: d === 'en' ? 'en' : 'ar', body: R.rateLimited(d).body, conversational: true }); }
        return 'HANDLED';
      }
      if (!this.gate.tryEnter(policy.rateLimits.globalConcurrency)) { await this.audit.record('concurrency', null, { outcome: 'DETERMINISTIC' }); return 'DETERMINISTIC'; }
      try { return await this.orchestrator.turn({ inbound, conversation: { id: conv.id, phone: conv.phone, locale: conv.locale }, profile, now }); }
      finally { this.gate.leave(); }
    } catch (e) {
      this.log.warn(`assistant turn failed, deterministic machine answers: ${(e as Error).constructor.name}`); // never the message: it may echo patient text
      await this.audit.record('router_error', null, { outcome: 'DETERMINISTIC', code: (e as Error).constructor.name });
      return 'DETERMINISTIC';
    }
  }
}
