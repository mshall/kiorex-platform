import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createPublicKey, X509Certificate, type KeyObject } from 'node:crypto';
import { cfg } from '../common/config';
import { outboundFetch } from '../common/outbound-http';
import { ApiError, notFound } from '../common/errors';
import { addressHash } from '../common/privacy-hash';
import { PrismaService } from '../prisma/prisma.service';
import { channelMode, classifyTransportError, createMessagingAdapter, PushAdapter } from './adapters';
import { providerEnv } from '../common/providers/env';
import { messagingKindOf, messagingMapping } from '../common/providers/real-adapters';
import { providerEnvFor } from './provider-select';
import { parseMetaAccountEvents, META_TIER_LIMITS } from '../common/providers/vendors/meta-whatsapp';
import { verifySnsSignature } from '../common/providers/vendors/ses';
import { setAggregatorConfig } from '../common/providers/vendors/sms-aggregator';
import { mergeStatus, normalizeVendorStatus, type DeliveryStatus as NotifyStatus } from '@kiorex/contracts/notify';
import { InboundHandler, InboundMessage, maskRecipient, MessagingAdapter, MSG_CHANNELS, MsgChannel, MsgStatus, OutboundMessage, SIMULATABLE_STATES } from './messaging.types';
import { effectiveMessagingConfig, failoverOrderFor, quietUntil, resolveSecretRef, type FailoverClass, type MessagingChannelsConfig, type QuietHours } from './messaging-config';
import { MetaWhatsappAdapter } from './whatsapp/meta.adapter';
import { PrismaWaTemplateStore, PrismaWaWindowStore, statusFromMetaEvent } from './whatsapp/wa-store';
import { WaTemplateRegistry } from './whatsapp/wa-templates';
import { windowState } from './whatsapp/wa-window';

const ORDER: MsgStatus[] = ['QUEUED', 'SENT', 'DELIVERED', 'READ'];
/** Raw MESSAGING_CHANNELS payload for a market (maker-checker config, growth module) or null when none is active. The growth module registers it; messaging imports nothing from it. */
export type MessagingConfigSource = (market: string) => Promise<MessagingChannelsConfig | null>;
/** Words that opt a number out, on every inbound channel, before any conversation logic (a legal opt-out, never a feature). Normalised: lower case, no punctuation. */
const STOP_WORDS = new Set(['stop', 'stopall', 'unsubscribe', 'وقف', 'ايقاف', 'إيقاف', 'الغاء الاشتراك', 'إلغاء الاشتراك', 'ايقاف الرسائل', 'وقف الرسائل']);
export const isStopKeyword = (t: string | undefined): boolean => !!t && STOP_WORDS.has(t.normalize('NFKC').toLowerCase().replace(/[.!؟?,،\s]+/g, ' ').trim());

/**
 * One hub for EMAIL / WHATSAPP / SMS / PUSH. Every send and every inbound is a MessageLog row (the "dev inbox" in mock mode).
 * Logs never carry bodies in real mode; console logs never carry recipients or bodies in any mode (PHI).
 */
@Injectable()
export class MessagingHub implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('messaging');
  private adapters = new Map<MsgChannel, MessagingAdapter>();
  private built = new Map<MsgChannel, { sig: string; adapter: MessagingAdapter }>();
  private inbound = new Map<MsgChannel, InboundHandler>();
  private timer?: NodeJS.Timeout;
  private receiptTimer?: NodeJS.Timeout;
  private configSource?: MessagingConfigSource;
  private cfgCache = new Map<string, { until: number; value: Omit<MessagingChannelsConfig, 'markets'>; quietExplicit: boolean }>();
  private snsKeys = new Map<string, KeyObject>();
  /** WhatsApp 24 h customer-service window store and the Meta template registry/status table. */
  readonly windows: PrismaWaWindowStore;
  readonly templateStore: PrismaWaTemplateStore;
  readonly waTemplates = new WaTemplateRegistry();
  constructor(private readonly prisma: PrismaService) {
    this.windows = new PrismaWaWindowStore(prisma);
    this.templateStore = new PrismaWaTemplateStore(prisma);
  }

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    this.timer = setInterval(() => void this.simulateDeliveries().catch(() => undefined), 5_000);
    this.timer.unref();
    this.receiptTimer = setInterval(() => void this.sweepPushReceipts().catch(() => undefined), 15 * 60_000);
    this.receiptTimer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); if (this.receiptTimer) clearInterval(this.receiptTimer); }

  mode() { return cfg().messagingMode; }
  channelMode(channel: MsgChannel) { return this.adapters.get(channel)?.mode ?? channelMode(channel); }

  // ───────────────────────── configuration (MESSAGING_CHANNELS) ─────────────────────────

  /** The growth module registers where the maker-checker payload comes from. Without it the env contract and the defaults apply. */
  setConfigSource(s: MessagingConfigSource) { this.configSource = s; this.cfgCache.clear(); }
  private cacheTtlMs(): number { const n = Number(process.env.MESSAGING_CONFIG_CACHE_TTL_MS); return Number.isFinite(n) && process.env.MESSAGING_CONFIG_CACHE_TTL_MS !== undefined && process.env.MESSAGING_CONFIG_CACHE_TTL_MS !== '' ? n : process.env.NODE_ENV === 'test' ? 0 : 5_000; }
  /** Effective configuration for a market (defaults < payload < payload.markets[market]), cached for a few seconds. Never throws: a failing source falls back to defaults. */
  async config(market = 'EG'): Promise<Omit<MessagingChannelsConfig, 'markets'>> {
    const hit = this.cfgCache.get(market);
    if (hit && hit.until > Date.now()) return hit.value;
    let payload: MessagingChannelsConfig | null = null;
    try { payload = (await this.configSource?.(market)) ?? null; } catch { payload = null; }
    const value = effectiveMessagingConfig(payload, market);
    this.cfgCache.set(market, { until: Date.now() + this.cacheTtlMs(), value, quietExplicit: !!(payload?.quietHours || payload?.markets?.[market]?.quietHours) });
    this.waTemplates.configure(value.whatsapp);
    if (market === 'EG') setAggregatorConfig((value.channels?.SMS?.aggregator as never) ?? undefined);
    return value;
  }
  /** Synchronous peek at the cached quiet hours of a market, ONLY when an operator set them in the MESSAGING_CHANNELS config (else undefined and the env default applies, so nothing changes until configured). */
  quietHoursSync(market = 'EG'): QuietHours | undefined { const c = this.cfgCache.get(market); return c?.quietExplicit ? c.value.quietHours : undefined; }
  /** End of the configured quiet window for a channel and market, or null when sending is allowed now. */
  async quietUntil(channel: MsgChannel, market = 'EG', nowMs = Date.now()): Promise<number | null> { return quietUntil(await this.config(market), channel, nowMs); }

  // ───────────────────────── adapters ─────────────────────────

  private envSig(channel: MsgChannel): string {
    const k = messagingKindOf(channel);
    const names = k ? [...['MODE', 'PROVIDER', 'API_URL', 'API_KEY', 'SENDER_ID', 'WEBHOOK_SECRET'].map((s) => `${k}_${s}`), 'MESSAGING_MODE'] : Object.keys(process.env).filter((n) => /^PUSH_|^MESSAGING_MODE$/.test(n));
    const c = this.cfgCache.get('EG')?.value.channels?.[channel];
    return `${names.map((n) => process.env[n] ?? '').join('|')}#${JSON.stringify([c?.providers, c?.secretRefs, c?.senderId])}`;
  }
  adapter(channel: MsgChannel): MessagingAdapter {
    const fixed = this.adapters.get(channel); if (fixed) return fixed;
    const sig = this.envSig(channel);
    const b = this.built.get(channel); if (b && b.sig === sig) return b.adapter;
    const adapter = createMessagingAdapter(channel, {
      config: this.cfgCache.get('EG')?.value,
      meta: { window: this.windows, templates: this.waTemplates, status: this.templateStore, onState: (e) => void this.persistWaState(e) },
    });
    this.built.set(channel, { sig, adapter });
    if (adapter instanceof MetaWhatsappAdapter) void this.restoreWaState(adapter);
    return adapter;
  }
  /** Tests / go-live wiring can replace an adapter. */
  setAdapter(a: MessagingAdapter) { this.adapters.set(a.channel, a); }
  /** Removes every adapter set with `setAdapter` (back to the env-driven ones). */
  clearAdapters() { this.adapters.clear(); }
  onInbound(channel: MsgChannel, h: InboundHandler) { this.inbound.set(channel, h); }

  private waAuthFailed = false;
  private async persistWaState(e: { type: 'THROTTLE'; untilMs: number; code: string } | { type: 'AUTH_FAILED'; code: string } | { type: 'OK' }) {
    try {
      if (e.type === 'THROTTLE') await this.setState('WHATSAPP', 'throttle', { untilMs: e.untilMs, code: e.code });
      else if (e.type === 'AUTH_FAILED') { this.waAuthFailed = true; await this.setState('WHATSAPP', 'auth', { failedAt: new Date().toISOString(), code: e.code }); this.log.error('[WHATSAPP] provider credentials refused: check the system-user token (see Docs/INTEGRATION_RUNBOOK_MESSAGING.md)'); }
      else if (this.waAuthFailed) { this.waAuthFailed = false; await this.prisma.messagingChannelState.deleteMany({ where: { channel: 'WHATSAPP', key: 'auth' } }); }
    } catch { /* state is advisory */ }
  }
  private async restoreWaState(a: MetaWhatsappAdapter) {
    try { const t = await this.prisma.messagingChannelState.findUnique({ where: { channel_key: { channel: 'WHATSAPP', key: 'throttle' } } }); const u = Number((t?.value as { untilMs?: number } | null)?.untilMs); if (Number.isFinite(u) && u > Date.now()) a.restoreThrottle(u); } catch { /* advisory */ }
  }
  async setState(channel: string, key: string, value: Record<string, unknown>) {
    await this.prisma.messagingChannelState.upsert({ where: { channel_key: { channel, key } }, create: { channel, key, value: value as never }, update: { value: value as never } });
  }
  async getState(channel: string, key: string): Promise<Record<string, unknown> | null> {
    const r = await this.prisma.messagingChannelState.findUnique({ where: { channel_key: { channel, key } } });
    return (r?.value as Record<string, unknown> | undefined) ?? null;
  }

  // ───────────────────────── send ─────────────────────────

  /** A hard-bounced or complained address is never written to again (reputation), on any message class. */
  private async hardSuppressed(m: OutboundMessage): Promise<boolean> {
    if (m.channel !== 'EMAIL') return false;
    return (await this.prisma.communicationSuppression.count({ where: { market: m.market ?? 'EG', addressHash: addressHash(m.to), channel: { in: ['EMAIL', 'ALL'] }, reason: { in: ['BOUNCE', 'COMPLAINT'] }, liftedAt: null } })) > 0;
  }

  async send(m: OutboundMessage) {
    const market = m.market ?? 'EG';
    const config = await this.config(market);
    const adapter = this.adapter(m.channel);
    const mock = adapter.mode === 'mock';
    const row = await this.prisma.messageLog.create({
      data: { messageId: m.messageId, channel: m.channel, direction: 'OUT', mode: adapter.mode, sub: m.sub, recipient: mock ? m.to : null, recipientMasked: maskRecipient(m.channel, m.to), templateId: m.templateId, locale: m.locale, body: mock ? m.body : null, status: 'QUEUED' },
    });
    try {
      if (await this.hardSuppressed(m)) {
        const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: 'ADDRESS_SUPPRESSED', failedAt: new Date() } });
        return { ...failed, ok: false, retryable: false };
      }
      const r = await adapter.send(m, { config, market, now: Date.now() });
      if (!r.ok && r.invalidToken && m.channel === 'PUSH') await this.prisma.deviceToken.updateMany({ where: { token: m.to, revokedAt: null }, data: { revokedAt: new Date() } }); // FCM UNREGISTERED / APNs Unregistered / Expo DeviceNotRegistered: stop pushing to a dead token
      if (!r.ok) {
        const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: (r.error ?? 'SEND_FAILED').slice(0, 200), failedAt: new Date() } });
        this.log.warn(`[${m.channel}] ${m.templateId} log=${row.id} FAILED ${r.error ?? ''}`);
        return { ...failed, ok: false, retryable: r.retryable ?? classifyTransportError(r.error).retryable };
      }
      const sent = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'SENT', providerRef: r.providerRef, sentAt: new Date() } });
      this.log.log(`[${m.channel}] ${m.templateId} log=${row.id} SENT${r.provider ? ` via ${r.provider}` : ''}`);
      return { ...sent, ok: true, retryable: false };
    } catch (e) {
      const failed = await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', error: String(e instanceof Error ? e.message : e).slice(0, 200), failedAt: new Date() } });
      this.log.warn(`[${m.channel}] ${m.templateId} log=${row.id} FAILED (adapter error)`);
      return { ...failed, ok: false, retryable: false };
    }
  }

  /**
   * Cross-channel failover for ONE logical message. The order comes from the configuration (`failoverOrder.<class>`, per market); a channel without an address in `targets` is
   * skipped; the first channel that ACCEPTS the message wins (acceptance, not delivery: a later delivery failure is a normal FAILED status). MARKETING never fails over.
   * Consent and quiet hours are decided upstream (the notification layer) for the chosen channels: this method only walks the order.
   */
  async sendWithFailover(base: Omit<OutboundMessage, 'channel' | 'to'>, targets: Partial<Record<MsgChannel, string>>, o: { messageClass?: FailoverClass; order?: MsgChannel[] } = {}) {
    const market = base.market ?? 'EG';
    const cls = o.messageClass ?? base.messageClass ?? 'TRANSACTIONAL';
    const order = (o.order ?? failoverOrderFor(await this.config(market), cls)).filter((c) => !!targets[c]);
    const attempts: Array<{ channel: MsgChannel; ok: boolean; error?: string | null }> = [];
    for (const channel of cls === 'MARKETING' ? order.slice(0, 1) : order) {
      const r = await this.send({ ...base, channel, to: targets[channel]!, messageClass: cls });
      attempts.push({ channel, ok: r.ok, error: r.error });
      if (r.ok) return { ok: true as const, channel, attempts, row: r };
    }
    return { ok: false as const, channel: undefined, attempts, row: undefined };
  }

  // ───────────────────────── inbound ─────────────────────────

  /** Opt-out by keyed hash (STOP keywords, SES bounces and complaints, one-click unsubscribe). Idempotent; a repeat after a lift suppresses again. */
  async suppress(address: string, channel: string, reason: 'STOP' | 'BOUNCE' | 'COMPLAINT', source: string, market = 'EG') {
    const h = addressHash(address);
    await this.prisma.communicationSuppression.upsert({ where: { market_channel_addressHash: { market, channel, addressHash: h } }, create: { market, channel, addressHash: h, reason, source }, update: { liftedAt: null, reason, source } });
  }
  async suppressHash(h: string, channel: string, reason: 'STOP' | 'BOUNCE' | 'COMPLAINT', source: string, market = 'EG') {
    await this.prisma.communicationSuppression.upsert({ where: { market_channel_addressHash: { market, channel, addressHash: h } }, create: { market, channel, addressHash: h, reason, source }, update: { liftedAt: null, reason, source } });
  }

  /**
   * Simulated patient message (dev inbox) or, in real mode, the verified provider webhook payload. Replay-safe: the same provider message id is stored once
   * (unique index) and not handled twice; the 24 h WhatsApp window is stamped before the handler runs so a reply sent from it sees an open window.
   */
  async receive(m: InboundMessage): Promise<Awaited<ReturnType<PrismaService['messageLog']['create']>> & { duplicate?: boolean }> {
    const market = m.market ?? 'EG';
    if (m.providerRef) {
      const dup = await this.prisma.messageLog.findFirst({ where: { channel: m.channel, direction: 'IN', providerRef: m.providerRef } });
      if (dup) return { ...dup, duplicate: true };
    }
    let row;
    try {
      row = await this.prisma.messageLog.create({
        data: { channel: m.channel, direction: 'IN', mode: this.channelMode(m.channel), recipient: m.from, recipientMasked: maskRecipient(m.channel, m.from), body: this.channelMode(m.channel) === 'mock' ? (m.text ?? m.buttonPayload ?? '') : null, status: 'RECEIVED', providerRef: m.providerRef, sentAt: new Date() },
      });
    } catch (e) {
      if ((e as { code?: string }).code === 'P2002' && m.providerRef) { const dup = await this.prisma.messageLog.findFirst({ where: { channel: m.channel, direction: 'IN', providerRef: m.providerRef } }); if (dup) return { ...dup, duplicate: true }; }
      throw e;
    }
    if (m.channel === 'WHATSAPP') await this.windows.touch(m.from, Math.min(m.occurredAtMs ?? Date.now(), Date.now()), market).catch(() => undefined);
    if ((m.channel === 'WHATSAPP' || m.channel === 'SMS') && isStopKeyword(m.text)) await this.suppress(m.from, m.channel, 'STOP', `${m.channel.toLowerCase()}-inbound`, market).catch(() => undefined);
    const h = this.inbound.get(m.channel);
    if (h) await h({ ...m, logId: row.id });
    return row;
  }

  /** Meta GET handshake token: env WHATSAPP_VERIFY_TOKEN, or the secretRef `channels.WHATSAPP.secretRefs.verifyToken` of the configuration. */
  async whatsappVerifyToken(): Promise<string> {
    const e = process.env.WHATSAPP_VERIFY_TOKEN?.trim(); if (e) return e;
    return resolveSecretRef((await this.config('EG')).channels?.WHATSAPP?.secretRefs?.verifyToken) ?? '';
  }

  /** The 24 h window of a number right now (ops and the assistant's send decision use the same function). */
  async whatsappWindow(phone: string, market = 'EG', nowMs = Date.now()) { return windowState(await this.windows.lastInboundMs(phone, market), nowMs, (await this.config(market)).whatsapp?.windowHours); }

  /** Delivery-state simulation: SENT -> DELIVERED (tick); READ / FAILED on demand. Never touches real-mode rows. */
  async simulateDeliveries() {
    const r = await this.prisma.messageLog.updateMany({ where: { mode: 'mock', direction: 'OUT', status: 'SENT' }, data: { status: 'DELIVERED', deliveredAt: new Date() } });
    return { delivered: r.count };
  }

  async simulate(id: string, state: MsgStatus) {
    if (!SIMULATABLE_STATES.includes(state)) throw notFound('UNSUPPORTED_STATE', `state must be one of ${SIMULATABLE_STATES.join('|')}`);
    const row = await this.prisma.messageLog.findUnique({ where: { id } });
    if (!row || row.mode !== 'mock' || row.direction !== 'OUT') throw notFound('MESSAGE_NOT_SIMULATABLE', 'Only mock outbound messages can be simulated');
    const now = new Date();
    if (state !== 'FAILED' && ORDER.indexOf(row.status as MsgStatus) >= ORDER.indexOf(state)) return row; // states only move forward
    const data = state === 'FAILED' ? { status: 'FAILED', failedAt: now, error: 'SIMULATED_FAILURE' } : state === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: now } : { status: 'READ', readAt: now, deliveredAt: row.deliveredAt ?? now };
    return this.prisma.messageLog.update({ where: { id }, data });
  }

  /** Expo receipts (the only reliable "dead token" signal for Expo tokens): revoke what came back DeviceNotRegistered. */
  async sweepPushReceipts() {
    const a = this.built.get('PUSH')?.adapter;
    if (!(a instanceof PushAdapter)) return { revoked: 0, checked: 0 };
    const r = await a.sweepExpoReceipts();
    for (const token of r.revoke) await this.prisma.deviceToken.updateMany({ where: { token, revokedAt: null }, data: { revokedAt: new Date() } });
    return { revoked: r.revoke.length, checked: r.checked };
  }

  private async snsPublicKey(url: string): Promise<KeyObject> {
    const hit = this.snsKeys.get(url); if (hit) return hit;
    const res = await outboundFetch(url, { method: 'GET' }); if (!res.ok) throw new Error('SNS_CERT');
    const key = createPublicKey(new X509Certificate(await res.text()).publicKey.export({ type: 'spki', format: 'pem' }));
    if (this.snsKeys.size > 20) this.snsKeys.clear();
    this.snsKeys.set(url, key); return key;
  }

  /**
   * Provider delivery-status webhook (SMS / EMAIL / WHATSAPP). Signature is verified with <KIND>_WEBHOOK_SECRET through the vendor
   * mapping (Meta: X-Hub-Signature-256 with the app secret; Twilio: X-Twilio-Signature; SNS: basic-auth password and, with EMAIL_SNS_VERIFY_SIGNATURE=true, the AWS message
   * signature; aggregator: token / HMAC); statuses are persisted on the MessageLog row found by providerRef, move forward only (so retries / out-of-order
   * deliveries are idempotent), and a FAILED delivery also fails the linked notification so the failure is visible to ops. Also: inbound messages (replay-safe),
   * Meta template review and quality events, and SES bounce / complaint -> suppression list.
   */
  async handleStatusWebhook(channel: string, rawBody: string, headers: Record<string, unknown>, query: Record<string, unknown> = {}, provider?: string) {
    const ch = channel.toUpperCase();
    const kind = messagingKindOf(ch);
    if (!kind || (providerEnv(kind).mode === 'mock' && cfg().isProd)) throw notFound('NOT_FOUND', 'Not found');
    const conf = await this.config('EG');
    const env = provider ? providerEnvFor(kind, provider.toLowerCase(), conf) : providerEnv(kind);
    const mapping = messagingMapping(kind, provider ? { ...process.env, [`${kind}_PROVIDER`]: provider.toLowerCase() } : process.env);
    if (!mapping.verifyWebhook({ secret: env.webhookSecret, rawBody, headers, publicUrl: env.publicWebhookUrl, query })) throw new ApiError(401, 'INVALID_SIGNATURE', 'Signature rejected');
    if (kind === 'EMAIL' && env.mode === 'real' && process.env.EMAIL_SNS_VERIFY_SIGNATURE === 'true' && !(await verifySnsSignature(rawBody, (u) => this.snsPublicKey(u), (process.env.EMAIL_SNS_TOPIC_ARNS ?? '').split(',').map((s) => s.trim()).filter(Boolean)))) throw new ApiError(401, 'INVALID_SIGNATURE', 'Signature rejected');
    const confirm = mapping.subscriptionConfirmUrl?.(rawBody);
    if (confirm) { await outboundFetch(confirm, { method: 'GET' }).catch(() => undefined); return { applied: 0, ignored: 0 }; } // SNS subscription handshake
    let applied = 0; let ignored = 0; let suppressed = 0;
    for (const inb of mapping.parseInbound?.(rawBody) ?? []) { const row = await this.receive({ channel: ch as MsgChannel, ...inb }); if (row.duplicate) ignored++; else applied++; } // vendor inbound customer messages (Meta WhatsApp)
    if (kind === 'WHATSAPP' && env.provider === 'meta') applied += await this.applyMetaAccountEvents(rawBody);
    for (const raw of mapping.parseStatusWebhook(rawBody)) {
      for (const s of raw.suppress ?? []) { await this.suppress(s.address, 'EMAIL', s.reason, 'ses-sns').catch(() => undefined); suppressed++; } // permanent bounce / complaint: stop writing to this address, even if the log row is gone
      const status = normalizeVendorStatus(kind, raw.status); // shared status model (@kiorex/contracts/notify); unknown vendor states are dropped, never guessed
      if (!status || status === 'SKIPPED') { ignored++; continue; }
      const ev = { ...raw, status };
      const row = await this.prisma.messageLog.findFirst({ where: { channel: ch, direction: 'OUT', providerRef: ev.providerRef } });
      if (!row) { ignored++; continue; }
      const at = ev.occurredAt && !Number.isNaN(Date.parse(ev.occurredAt)) ? new Date(ev.occurredAt) : new Date();
      if (ev.status === 'FAILED') {
        if (row.status === 'FAILED' || row.status === 'READ') { ignored++; continue; }
        await this.prisma.messageLog.update({ where: { id: row.id }, data: { status: 'FAILED', failedAt: at, error: ev.error ?? 'DELIVERY_FAILED' } });
        if (row.messageId) await this.prisma.message.updateMany({ where: { id: row.messageId }, data: { status: 'FAILED', reason: (ev.error ?? 'DELIVERY_FAILED').slice(0, 200) } });
        applied++; continue;
      }
      if (mergeStatus(row.status as NotifyStatus, ev.status) === row.status) { ignored++; continue; } // forward-only: replays and out-of-order events are no-ops
      const data = ev.status === 'READ' ? { status: 'READ', readAt: at, deliveredAt: row.deliveredAt ?? at } : ev.status === 'DELIVERED' ? { status: 'DELIVERED', deliveredAt: at } : { status: ev.status, sentAt: row.sentAt ?? at };
      await this.prisma.messageLog.update({ where: { id: row.id }, data });
      applied++;
    }
    return { applied, ignored, ...(suppressed ? { suppressed } : {}) };
  }

  /** Meta template review / template quality / phone-number quality and tier events. Unknown templates are ignored, never created from a webhook. */
  private async applyMetaAccountEvents(rawBody: string): Promise<number> {
    let n = 0;
    for (const e of parseMetaAccountEvents(rawBody)) {
      if (e.type === 'TEMPLATE_STATUS') { if (await this.templateStore.apply({ metaName: e.name, language: e.language.slice(0, 2), status: statusFromMetaEvent(e.event), metaTemplateId: e.templateId, reason: e.reason ?? '', at: new Date() })) n++; }
      else if (e.type === 'TEMPLATE_QUALITY') { if (await this.templateStore.apply({ metaName: e.name, language: e.language.slice(0, 2), quality: e.quality, metaTemplateId: e.templateId, at: new Date() })) n++; }
      else if (e.type === 'PHONE_QUALITY') {
        await this.setState('WHATSAPP', 'quality', { event: e.event, tier: e.tier ?? null, tierLimit: e.tier ? (META_TIER_LIMITS[e.tier] ?? null) : null, at: new Date().toISOString() });
        const a = this.built.get('WHATSAPP')?.adapter; if (a instanceof MetaWhatsappAdapter && e.tier) a.setTier(e.tier);
        this.log.warn(`[WHATSAPP] phone number quality event ${e.event}${e.tier ? ` tier=${e.tier}` : ''}`); n++;
      } else { await this.setState('WHATSAPP', 'account', { event: e.event, at: new Date().toISOString() }); this.log.warn(`[WHATSAPP] account event ${e.event}`); n++; }
    }
    return n;
  }

  // ───────────────────────── views ─────────────────────────
  async list(q: { channel?: string; status?: string; direction?: string; to?: string; since?: Date; limit?: number }) {
    return this.prisma.messageLog.findMany({
      where: { ...(q.channel ? { channel: q.channel.toUpperCase() } : {}), ...(q.status ? { status: q.status.toUpperCase() } : {}), ...(q.direction ? { direction: q.direction.toUpperCase() } : {}), ...(q.to ? { recipient: q.to } : {}), ...(q.since ? { createdAt: { gte: q.since } } : {}) },
      orderBy: { createdAt: 'desc' }, take: Math.min(q.limit ?? 100, 500),
    });
  }
  async stats() {
    const rows = await this.prisma.messageLog.groupBy({ by: ['channel', 'direction', 'status'], _count: true });
    return { mode: cfg().messagingMode, channels: MSG_CHANNELS, counts: rows.map((r) => ({ channel: r.channel, direction: r.direction, status: r.status, count: r._count })) };
  }
  async clear(channel?: string) {
    if (cfg().messagingMode !== 'mock') throw notFound('NOT_FOUND', 'Not found');
    return this.prisma.messageLog.deleteMany({ where: channel ? { channel: channel.toUpperCase() } : {} });
  }
}
