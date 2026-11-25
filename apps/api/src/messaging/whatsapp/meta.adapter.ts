import { providerEnv, type ProviderEnv } from '../../common/providers/env';
import { ProviderError, providerRequest, type HttpDeps } from '../../common/providers/http';
import { bearer } from '../../common/providers/mapping-types';
import {
  classifyMetaError, META_TIER_LIMITS, MetaPayloadError, metaInteractiveButtonsBody, metaInteractiveListBody, metaTemplateBody, metaTextBody, parseMetaSend, type InteractiveButton, type InteractiveRow,
} from '../../common/providers/vendors/meta-whatsapp';
import { effectiveMessagingConfig, retryFor, type MessagingChannelsConfig } from '../messaging-config';
import { BackoffGate, RateBudget, type Clock } from '../throttle';
import type { MessagingAdapter, OutboundMessage, SendContext, SendResult } from '../messaging.types';
import { decideWhatsappSend, windowState, type WaWindowStore } from './wa-window';
import { WaTemplateRegistry, type WaTemplateStatusStore } from './wa-templates';

export interface MetaAdapterDeps {
  env?: ProviderEnv;
  http?: HttpDeps;
  window: WaWindowStore;
  templates: WaTemplateRegistry;
  status?: WaTemplateStatusStore;
  now?: Clock;
  /** Called on state-changing vendor outcomes (throttle, auth) so the hub can persist them and alert ops. */
  onState?: (e: { type: 'THROTTLE'; untilMs: number; code: string } | { type: 'AUTH_FAILED'; code: string } | { type: 'OK' }) => void;
}

/**
 * Native Meta WhatsApp Cloud API adapter (WHATSAPP_PROVIDER=meta). Decides per message, with the stored 24 h window:
 *   session text | interactive reply buttons / list (payload round-trips verbatim) | approved template (+ quick-reply payloads), or refuses with a stable code.
 * Also: per-market sender id, rate budget, tier / pair-rate backoff, error classification (never stores vendor text), one template fallback when the window
 * turned out closed (Meta 131047), fail-fast for REJECTED / PAUSED / DISABLED templates. It never logs bodies, recipients or tokens.
 */
export class MetaWhatsappAdapter implements MessagingAdapter {
  readonly mode = 'real' as const;
  readonly channel = 'WHATSAPP' as const;
  private readonly budgets = new Map<string, RateBudget>();
  private readonly gate: BackoffGate;
  private readonly now: Clock;
  constructor(private readonly d: MetaAdapterDeps) {
    this.now = d.now ?? Date.now;
    this.gate = new BackoffGate(effectiveMessagingConfig(undefined).whatsapp?.throttleBackoffSeconds, this.now);
  }
  private tierLimit = Number.POSITIVE_INFINITY;
  /** Business-initiated conversations (template sends outside the window) per rolling 24 h: unique recipients, in memory per process. */
  private readonly opened = new Map<string, number>();
  /** Meta messaging tier from a phone_number_quality_update webhook (TIER_1K ...): caps the unique people messaged outside the window per 24 h. */
  setTier(tier: string) { const n = META_TIER_LIMITS[tier]; if (n !== undefined && n > 0) this.tierLimit = n; }
  /** Restore a throttle another instance persisted. */
  restoreThrottle(untilMs: number) { this.gate.restore(untilMs); }
  get throttledForMs() { return this.gate.remainingMs(); }

  private budget(market: string, cfg: MessagingChannelsConfig): RateBudget {
    const b = cfg.channels?.WHATSAPP?.rateBudget ?? {};
    const key = `${market}|${b.perSecond ?? ''}|${b.perMinute ?? ''}|${b.perDay ?? ''}`;
    let r = this.budgets.get(key); if (!r) { r = new RateBudget(b, this.now); this.budgets.set(key, r); }
    return r;
  }

  async send(m: OutboundMessage, ctx?: SendContext): Promise<SendResult> {
    const market = ctx?.market ?? m.market ?? 'EG';
    const cfg = ctx?.config ?? effectiveMessagingConfig(undefined, market);
    const env = this.d.env ?? providerEnv('WHATSAPP');
    const fail = (error: string, extra: Partial<SendResult> = {}): SendResult => ({ ok: false, providerRef: '', error, provider: 'meta', ...extra });
    if (cfg.channels?.WHATSAPP?.enabled === false) return fail('CHANNEL_DISABLED', { retryable: false });
    if (this.gate.remainingMs() > 0) return fail('THROTTLED', { retryable: true });

    const senderId = (cfg.channels?.WHATSAPP?.senderId || env.senderId || '').trim();
    if (!senderId) return fail('WA_SENDER_NOT_CONFIGURED', { retryable: false });
    const nowMs = this.now();
    const lastIn = await this.d.window.lastInboundMs(m.to, market);
    const win = windowState(lastIn, nowMs, cfg.whatsapp?.windowHours);

    const buttons = Array.isArray(m.data?.buttons) ? (m.data!.buttons as InteractiveButton[]) : undefined;
    const list = m.data?.list as { buttonLabel: string; rows: InteractiveRow[] } | undefined;
    const interactive = !!(buttons?.length || list?.rows?.length);
    const tpl = this.d.templates.resolve(m.templateId, m.locale);
    const tplEnabled = !!tpl && tpl.enabled;
    const quickFits = !!tpl?.quickReplies && !!buttons && tpl.quickReplies.length === buttons.length;

    // fail fast on a template Meta has disabled: no call, no cost, a clear error for ops
    let tplStatus = null as Awaited<ReturnType<WaTemplateStatusStore['get']>>;
    if (tpl && this.d.status) tplStatus = await this.d.status.get(tpl.metaName, tpl.language);
    const tplBlocked = !!tplStatus && ['REJECTED', 'PAUSED', 'DISABLED'].includes(tplStatus.status) && cfg.whatsapp?.requireApprovedTemplates !== false;
    const tplUsable = tplEnabled && !tplBlocked;

    const decision = decideWhatsappSend({ interactive, windowOpen: win.open, templateAvailable: tplUsable, templateQuickReplyFits: quickFits, conversational: !!m.conversational || interactive });
    if ('refuse' in decision) {
      if (decision.refuse === 'WA_NO_TEMPLATE' && tplBlocked) return fail('WA_TEMPLATE_NOT_APPROVED', { retryable: false });
      return fail(decision.refuse, { retryable: false });
    }
    const opening = decision.mode === 'TEMPLATE' || decision.mode === 'TEMPLATE_QUICK_REPLY';
    if (opening && Number.isFinite(this.tierLimit)) {
      for (const [k, t] of this.opened) if (t <= nowMs - 86_400_000) this.opened.delete(k);
      if (!this.opened.has(m.to) && this.opened.size >= this.tierLimit) return fail('WA_TIER_LIMIT', { retryable: true });
    }
    if (!this.budget(market, cfg).tryTake()) return fail('RATE_BUDGET', { retryable: true });

    const attempt = async (mode: typeof decision.mode): Promise<SendResult> => {
      let body: unknown;
      try {
        if (mode === 'SESSION_INTERACTIVE') {
          body = buttons?.length ? metaInteractiveButtonsBody({ to: m.to, body: m.body, buttons }) : metaInteractiveListBody({ to: m.to, body: m.body, buttonLabel: list!.buttonLabel, rows: list!.rows });
        } else if (mode === 'SESSION_TEXT') {
          body = metaTextBody({ to: m.to, body: m.body });
        } else {
          const p = WaTemplateRegistry.params(tpl!, m.variables);
          if ('missing' in p) return fail('WA_TEMPLATE_PARAM_MISSING', { retryable: false });
          body = metaTemplateBody({ to: m.to, templateName: tpl!.metaName, language: tpl!.language, bodyParams: p.values, ...(mode === 'TEMPLATE_QUICK_REPLY' ? { quickReplyPayloads: buttons!.map((b) => b.id) } : {}) });
        }
      } catch (e) {
        if (e instanceof MetaPayloadError) return fail(e.code, { retryable: false });
        throw e;
      }
      const retry = retryFor(cfg, 'WHATSAPP');
      const e2: ProviderEnv = { ...env, senderId, maxRetries: retry.maxRetries };
      try {
        const r = await providerRequest(e2, { path: `/${encodeURIComponent(senderId)}/messages`, body, idempotencyKey: m.messageId }, this.d.http ?? {}, bearer(env.apiKey));
        const providerRef = parseMetaSend(r.json).providerRef;
        this.gate.success(); this.d.onState?.({ type: 'OK' });
        if (opening) this.opened.set(m.to, nowMs);
        return { ok: true, providerRef, provider: 'meta' };
      } catch (e) {
        if (!(e instanceof ProviderError)) return fail('PROVIDER_BAD_RESPONSE', { retryable: false });
        const action = classifyMetaError(e.vendorCode);
        const code = e.vendorCode ? `META_${e.vendorCode}` : e.message;
        if (action === 'THROTTLE' || e.code === 'RATE_LIMITED') { const until = this.gate.trip(); this.d.onState?.({ type: 'THROTTLE', untilMs: until, code: e.vendorCode ?? '429' }); return fail(`THROTTLED:${code}`, { retryable: true }); }
        if (action === 'AUTH' || e.code === 'UNAUTHORIZED') { this.d.onState?.({ type: 'AUTH_FAILED', code: e.vendorCode ?? String(e.status ?? '') }); return fail(code, { retryable: false }); }
        if (action === 'NEED_TEMPLATE') return fail('META_131047', { retryable: false });
        if (action === 'INVALID_RECIPIENT') return fail(code, { retryable: false, recipientRejected: true });
        if (action === 'TEMPLATE' || action === 'PAYLOAD') return fail(code, { retryable: false });
        return fail(code, { retryable: e.retryable });
      }
    };

    const first = await attempt(decision.mode);
    // window drift: we believed it was open (clock skew, a different handset) but Meta says 131047 -> one template attempt when we have one
    if (!first.ok && first.error === 'META_131047' && (decision.mode === 'SESSION_TEXT' || decision.mode === 'SESSION_INTERACTIVE') && tplUsable && (!interactive || quickFits)) {
      return attempt(interactive ? 'TEMPLATE_QUICK_REPLY' : 'TEMPLATE');
    }
    return first;
  }
}
