import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { ApiError, badRequest } from '../common/errors';
import { outboundFetch } from '../common/outbound-http';
import { providerEnv } from '../common/providers/env';
import { providerRequest, ProviderError, type HttpDeps } from '../common/providers/http';
import { bearer } from '../common/providers/mapping-types';
import { messagingKindOf, type MessagingKind } from '../common/providers/real-adapters';
import { apnsJwt, apnsProblems } from '../common/providers/vendors/apns';
import { metaTemplateSubmission } from '../common/providers/vendors/meta-whatsapp';
import { PushSender, pushConfigFromEnv, pushProblems } from '../common/providers/vendors/push';
import { awsRegionFromHost, signV4 } from '../common/providers/vendors/sigv4';
import { parseSesCreds } from '../common/providers/vendors/ses';
import { twilioAuth, twilioCreds } from '../common/providers/vendors/twilio-sms';
import { PrismaService } from '../prisma/prisma.service';
import { checkEmailDomain, nodeDns, type DnsResolver } from './email-domain-auth';
import { MessagingHub } from './messaging.hub';
import { MSG_CHANNELS, type MsgChannel } from './messaging.types';
import { CHANNEL_KEYS, resolveSecretRef, secretEnvName } from './messaging-config';
import { providerEnvFor, providerOrder, providerProblemsFor } from './provider-select';
import { statusFromMetaEvent } from './whatsapp/wa-store';
import { templatesCsv } from './whatsapp/wa-templates';

export interface CheckItem { name: string; ok: boolean; detail: string; skipped?: boolean }
const mask = (v: string) => (v.length <= 8 ? '****' : `${v.slice(0, 2)}****${v.slice(-2)}`);
const allowList = (env = process.env) => (env.MESSAGING_TEST_ALLOWLIST ?? '').split(/[,;\s]+/).map((s) => s.trim().toLowerCase()).filter(Boolean);
const normAddr = (s: string) => s.trim().toLowerCase().replace(/[\s()-]/g, '');

/**
 * Ops tools for the four channels (super admin / ops): status with config PROBLEMS (names only), the webhook URLs and verify token to paste into the Meta / SES / SMS
 * consoles, a TEST SEND restricted to an allow-listed internal number or e-mail, a CONNECTION CHECK that makes only read-only vendor calls, the WhatsApp template registry
 * (list, export for approval, status sync, submit) and the e-mail domain checklist. Mock mode: test send goes through the mock adapter (dev inbox), the connection check
 * makes NO network call. Nothing returns or logs a secret value; only `secretRef` names and a boolean "present".
 */
@Injectable()
export class MessagingOpsService {
  private testSends = new Map<string, number[]>();
  /** Replaceable for tests: every vendor call of the connection check, sync and submit goes through this. */
  http: HttpDeps = { fetchImpl: outboundFetch };
  dns: () => Promise<DnsResolver> = nodeDns;
  now: () => number = Date.now;
  constructor(private readonly hub: MessagingHub, private readonly prisma: PrismaService) {}

  private async audit(actor: string, action: string, resourceId: string, metadata: Record<string, unknown>) {
    await this.prisma.auditLog.create({ data: { actor, action, resource: 'MessagingChannel', resourceId, metadata: metadata as never } }).catch(() => undefined);
  }
  private chan(c: string): MsgChannel { const u = c.toUpperCase(); if (!(MSG_CHANNELS as readonly string[]).includes(u)) throw badRequest('UNKNOWN_CHANNEL', 'channel must be EMAIL, WHATSAPP, SMS or PUSH'); return u as MsgChannel; }
  private base() { return cfg().publicBaseUrl.replace(/\/+$/, '') + '/api/v1'; }

  // ───────────────────────── status ─────────────────────────

  async status(market = 'EG') {
    const conf = await this.hub.config(market);
    const out = [];
    for (const channel of MSG_CHANNELS) {
      const kind = messagingKindOf(channel);
      const mode = this.hub.channelMode(channel);
      const settings = conf.channels?.[channel] ?? {};
      let providers: Array<{ provider: string; problems: string[]; secretRef: string | null; secretRefPresent: boolean | null }> = [];
      if (kind) providers = providerOrder(kind, conf).map((p) => { const ref = settings.secretRefs?.[p] ?? settings.secretRefs?.default ?? null; return { provider: p, problems: mode === 'real' ? providerProblemsFor(kind, p, conf) : [], secretRef: ref, secretRefPresent: ref ? resolveSecretRef(ref) !== null : null }; });
      else { const pp = mode === 'real' ? pushProblems(process.env) : []; providers = [{ provider: 'fcm|apns|expo', problems: pp, secretRef: settings.secretRefs?.default ?? null, secretRefPresent: settings.secretRefs?.default ? resolveSecretRef(settings.secretRefs.default) !== null : null }]; }
      const state = channel === 'WHATSAPP' ? { quality: await this.hub.getState('WHATSAPP', 'quality'), throttle: await this.hub.getState('WHATSAPP', 'throttle'), auth: await this.hub.getState('WHATSAPP', 'auth') } : undefined;
      out.push({
        channel, mode, enabled: settings.enabled !== false, senderId: settings.senderId || (kind ? providerEnv(kind).senderId : '') || null, retry: settings.retry ?? null, rateBudget: settings.rateBudget ?? null,
        providers, ready: mode === 'mock' || providers.some((p) => p.problems.length === 0), webhook: kind ? `${this.base()}/messaging/webhooks/${channel.toLowerCase()}` : null, state,
      });
    }
    return { market, publicBaseUrl: cfg().publicBaseUrl, failoverOrder: conf.failoverOrder, quietHours: conf.quietHours, channels: out, testAllowListSize: allowList().length };
  }

  // ───────────────────────── webhook display ─────────────────────────

  /** What to paste into the vendor console. The verify token and the SNS basic-auth URL are shown only on `reveal` (super admin, audited); everything else is public. */
  async webhookInfo(channel: string, actor: string, reveal = false) {
    const ch = this.chan(channel); const kind = messagingKindOf(ch);
    if (!kind) return { channel: ch, note: 'Push has no inbound webhook: delivery feedback comes from the provider response, APNs / FCM errors and Expo receipts.' };
    const e = providerEnv(kind); const url = `${this.base()}/messaging/webhooks/${ch.toLowerCase()}`;
    if (reveal) await this.audit(actor, 'messaging.webhook_info.reveal', ch, { channel: ch });
    if (ch === 'WHATSAPP') {
      const tok = await this.hub.whatsappVerifyToken();
      return { channel: ch, provider: e.provider, callbackUrl: url, verifyToken: reveal ? tok || null : tok ? mask(tok) : null, verifyTokenSet: !!tok, appSecretSet: !!e.webhookSecret,
        subscribeFields: ['messages', 'message_template_status_update', 'message_template_quality_update', 'phone_number_quality_update', 'account_update'],
        steps: ['Meta App > WhatsApp > Configuration > Webhook: paste the callback URL and the verify token, then Verify and save.', 'Subscribe to the fields listed (messages is mandatory).', 'The app secret (WHATSAPP_WEBHOOK_SECRET) is the Meta App "App secret": it signs every POST (X-Hub-Signature-256).'] };
    }
    if (ch === 'EMAIL') {
      const u = new URL(url); if (reveal && e.webhookSecret) { u.username = 'sns'; u.password = e.webhookSecret; }
      return { channel: ch, provider: e.provider, subscriptionUrl: reveal ? u.toString() : url.replace('://', '://sns:****@'), protocol: 'https', webhookSecretSet: !!e.webhookSecret,
        steps: ['AWS SES > Configuration set > Event destinations > Amazon SNS topic (Send, Delivery, Bounce, Complaint, Reject).', 'SNS topic > Create subscription > protocol HTTPS > endpoint is the subscription URL (the password is EMAIL_WEBHOOK_SECRET).', 'The platform confirms the subscription automatically; it only follows https://sns.<region>.amazonaws.com links.'] };
    }
    const p = e.provider;
    return { channel: ch, provider: p, callbackUrl: p === 'aggregator' ? `${url}?token=${reveal ? e.webhookSecret || '' : '****'}` : e.publicWebhookUrl || url, webhookSecretSet: !!e.webhookSecret,
      steps: p === 'twilio' ? ['Twilio: the platform sends StatusCallback = SMS_WEBHOOK_PUBLIC_URL with every message; set it to the callback URL. The signature uses the Auth Token.'] : ['Give the aggregator this delivery-report (DLR) callback URL. Unsigned callbacks are refused: the token (or HMAC header) must match SMS_WEBHOOK_SECRET.'] };
  }

  // ───────────────────────── test send ─────────────────────────

  /** Allow-list only (env MESSAGING_TEST_ALLOWLIST: internal numbers and e-mail addresses; PUSH: a device token of an account in MESSAGING_TEST_ALLOWLIST_SUBS). 5 per hour per person. */
  async testSend(channel: string, to: string, actor: string, market = 'EG') {
    const ch = this.chan(channel);
    const key = `${actor}`; const t = this.now(); const hist = (this.testSends.get(key) ?? []).filter((x) => x > t - 3_600_000);
    if (hist.length >= 5) throw new ApiError(429, 'TEST_SEND_RATE_LIMITED', 'At most 5 test sends per hour');
    if (ch === 'PUSH') {
      const subs = (process.env.MESSAGING_TEST_ALLOWLIST_SUBS ?? '').split(/[,;\s]+/).filter(Boolean);
      const dev = subs.length ? await this.prisma.deviceToken.findFirst({ where: { token: to, sub: { in: subs }, revokedAt: null } }) : null;
      if (!dev) { await this.audit(actor, 'messaging.test_send.refused', ch, { reason: 'NOT_ALLOWLISTED' }); throw new ApiError(403, 'TEST_SEND_NOT_ALLOWLISTED', 'The device is not registered to an allow-listed internal account'); }
    } else if (!allowList().includes(normAddr(to))) {
      await this.audit(actor, 'messaging.test_send.refused', ch, { reason: 'NOT_ALLOWLISTED' });
      throw new ApiError(403, 'TEST_SEND_NOT_ALLOWLISTED', 'Test sends go only to an address listed in MESSAGING_TEST_ALLOWLIST');
    }
    hist.push(t); this.testSends.set(key, hist);
    const stamp = new Date(t).toISOString().slice(11, 16);
    const body = `Kiorex test message ${stamp} UTC. No action needed.`;
    const r = await this.hub.send({ channel: ch, to, templateId: 'MSG_TEST', locale: 'en', body, subject: 'Kiorex test message', market, messageClass: 'TRANSACTIONAL', variables: { time: stamp }, data: ch === 'PUSH' ? { kind: 'test' } : undefined, conversational: false });
    await this.audit(actor, 'messaging.test_send', ch, { ok: r.ok, status: r.status, error: r.error ?? null, mode: r.mode, logId: r.id });
    const hint = r.error === 'WA_NO_TEMPLATE' ? 'No approved template and no open 24 h window: send "hi" to the business number from this phone first, or approve kx_msg_test_v1.' : r.error === 'WA_TEMPLATE_NOT_APPROVED' ? 'The test template is not APPROVED yet.' : undefined;
    return { ok: r.ok, logId: r.id, status: r.status, mode: r.mode, error: r.error ?? null, providerRef: r.providerRef ?? null, hint };
  }

  // ───────────────────────── connection check ─────────────────────────

  /** Read-only vendor calls (account / profile / identity / token), never a message. Mock mode: configuration checks only, NO network. */
  async connectionCheck(channel: string, actor: string, market = 'EG') {
    const ch = this.chan(channel); const mode = this.hub.channelMode(ch); const conf = await this.hub.config(market);
    const checks: CheckItem[] = [];
    const add = (name: string, ok: boolean, detail: string, skipped = false) => checks.push({ name, ok, detail: detail.slice(0, 300), ...(skipped ? { skipped } : {}) });
    if (mode === 'mock') {
      add('mode', true, `${ch}_MODE=mock: nothing leaves the platform. Set ${ch === 'PUSH' ? 'PUSH_MODE' : `${ch}_MODE`}=real (env, deploy-time) to check the vendor.`, true);
      return { channel: ch, mode, ok: true, checks };
    }
    const kind = messagingKindOf(ch) as MessagingKind | undefined;
    const call = async <T>(f: () => Promise<T>): Promise<T | null> => { try { return await f(); } catch (e) { add('vendor call', false, e instanceof ProviderError ? `${e.message}${e.vendorCode ? ` (vendor code ${e.vendorCode})` : ''}` : 'call failed'); return null; } };
    if (kind) {
      const providers = providerOrder(kind, conf);
      for (const p of providers) {
        const problems = providerProblemsFor(kind, p, conf);
        add(`config ${p}`, problems.length === 0, problems.length ? problems.join('; ') : 'all required variables present');
      }
      const p = providers[0]; const e = providerEnvFor(kind, p, conf);
      if (!providerProblemsFor(kind, p, conf).length) {
        if (ch === 'WHATSAPP' && p === 'meta') {
          const r = await call(() => providerRequest({ ...e, maxRetries: 0 }, { method: 'GET', path: `/${encodeURIComponent(e.senderId)}?fields=display_phone_number,verified_name,quality_rating,code_verification_status,platform_type`, absoluteUrl: undefined }, this.http, bearer(e.apiKey)));
          if (r) { add('phone number', true, `${r.json?.display_phone_number ?? '?'} (${r.json?.verified_name ?? 'name not verified'}), quality ${r.json?.quality_rating ?? 'n/a'}`); await this.hub.setState('WHATSAPP', 'profile', { quality: r.json?.quality_rating ?? null, at: new Date(this.now()).toISOString() }); }
          const waba = conf.channels?.WHATSAPP?.wabaId;
          if (!waba) add('WABA id', false, 'channels.WHATSAPP.wabaId is not configured (needed for template sync and submit)', true);
          else {
            const t = await call(() => providerRequest({ ...e, maxRetries: 0 }, { method: 'GET', path: `/${waba}/message_templates?limit=1&fields=name,status`, }, this.http, bearer(e.apiKey)));
            if (t) add('templates access', true, 'message_templates readable');
            const s = await call(() => providerRequest({ ...e, maxRetries: 0 }, { method: 'GET', path: `/${waba}/subscribed_apps` }, this.http, bearer(e.apiKey)));
            if (s) add('webhook subscription', Array.isArray(s.json?.data) && s.json.data.length > 0, Array.isArray(s.json?.data) && s.json.data.length ? 'this WABA has a subscribed app' : 'no app is subscribed to this WABA: subscribe it (POST /{waba}/subscribed_apps)');
          }
          add('verify token', !!(await this.hub.whatsappVerifyToken()), 'WHATSAPP_VERIFY_TOKEN (the GET handshake)');
        } else if (ch === 'EMAIL' && p === 'ses') {
          const creds = parseSesCreds(e.apiKey); const region = awsRegionFromHost(new URL(e.apiUrl).host);
          const sign = creds && region ? (r: { method: string; url: string; body: string }) => signV4({ ...r, ...creds, region, service: 'ses' }) : undefined;
          const a = await call(() => providerRequest({ ...e, maxRetries: 0 }, { method: 'GET', path: '/v2/email/account', sign }, this.http));
          if (a) {
            add('sending enabled', a.json?.SendingEnabled !== false, `SendingEnabled=${a.json?.SendingEnabled}`);
            add('production access', a.json?.ProductionAccessEnabled === true, a.json?.ProductionAccessEnabled ? 'out of the SES sandbox' : 'SES SANDBOX: only verified recipients (request production access in the AWS console)');
            add('quota', true, `max ${a.json?.SendQuota?.Max24HourSend ?? '?'} / 24 h, ${a.json?.SendQuota?.MaxSendRate ?? '?'} per second, sent ${a.json?.SendQuota?.SentLast24Hours ?? '?'}`);
          }
          const from = e.senderId.match(/<([^>]+)>/)?.[1] ?? e.senderId; const domain = from.split('@')[1];
          if (domain) {
            const id = await call(() => providerRequest({ ...e, maxRetries: 0 }, { method: 'GET', path: `/v2/email/identities/${encodeURIComponent(domain)}`, sign }, this.http));
            if (id) { add('identity', id.json?.VerifiedForSendingStatus === true, `domain ${domain} verified=${id.json?.VerifiedForSendingStatus}`); add('DKIM', id.json?.DkimAttributes?.Status === 'SUCCESS', `DKIM status ${id.json?.DkimAttributes?.Status ?? 'unknown'}, signing ${id.json?.DkimAttributes?.SigningEnabled}`); }
          }
        } else if (ch === 'SMS' && p === 'twilio') {
          const c = twilioCreds(e.apiKey);
          const r = c && (await call(() => providerRequest({ ...e, maxRetries: 0 }, { method: 'GET', path: `/2010-04-01/Accounts/${encodeURIComponent(c.sid)}.json` }, this.http, twilioAuth(e.apiKey))));
          if (r) add('account', r.json?.status === 'active', `account status ${r.json?.status ?? 'unknown'}`);
        } else if (ch === 'SMS' && p === 'aggregator') {
          add('aggregator', true, 'Aggregators have no standard harmless ping: use Test send to your own number. Check the sender name is registered with the operators.', true);
        } else add('vendor call', true, 'gateway provider: no standard check endpoint; use Test send', true);
      }
    } else {
      const pcfg = pushConfigFromEnv(process.env);
      const problems = pushProblems(process.env); add('config', problems.length === 0, problems.length ? problems.join('; ') : 'push credentials present');
      if (pcfg.fcmServiceAccountJson?.trim()) {
        const sender = new PushSender(pcfg, (this.http.fetchImpl ?? outboundFetch) as never, this.now);
        const r = await sender.send({ token: 'connection-check-not-a-real-token', title: 'check', body: 'check', validateOnly: true });
        // validate_only never delivers: INVALID_ARGUMENT means authentication worked and only the fake token was rejected; an auth failure shows as FCM_AUTH or 401/403
        add('FCM auth + request validation', !!r.ok || /INVALID_ARGUMENT/.test(r.error ?? '') && !r.authFailed, r.ok ? 'validate_only accepted' : r.error ?? 'failed');
      }
      if (pcfg.apns) {
        const ap = apnsProblems(pcfg.apns);
        if (ap.length) add('APNs config', false, ap.join('; ')); else { try { const j = apnsJwt(pcfg.apns, this.now()); add('APNs key', j.split('.').length === 3, 'the .p8 parses and signs an ES256 token (APNs has no ping: the first real push proves topic and environment)'); } catch { add('APNs key', false, 'the .p8 could not sign'); } }
      }
      if (pcfg.expoAccessToken || process.env.PUSH_EXPO_ENABLED === 'true') {
        const sender = new PushSender(pcfg, (this.http.fetchImpl ?? outboundFetch) as never, this.now);
        const r = await sender.expoReceipts([]).then(() => true).catch(() => false);
        add('Expo', r, r ? 'receipts endpoint reachable' : 'Expo unreachable');
      }
    }
    const ok = checks.every((c) => c.ok || c.skipped);
    await this.audit(actor, 'messaging.connection_check', ch, { ok, failed: checks.filter((c) => !c.ok && !c.skipped).map((c) => c.name) });
    return { channel: ch, mode, ok, checks };
  }

  /** SPF / DKIM / DMARC from DNS (DKIM tokens from the SES identity when reachable). */
  async emailDomainCheck(domain: string, dkimTokens: string[] = []) {
    if (!/^[a-z0-9.-]{3,253}$/i.test(domain)) throw badRequest('INVALID_DOMAIN', 'domain must be a DNS name');
    return { domain, checks: await checkEmailDomain(domain.toLowerCase(), await this.dns(), { dkimTokens, mailFromDomain: process.env.EMAIL_MAIL_FROM_DOMAIN || undefined }) };
  }

  // ───────────────────────── WhatsApp templates ─────────────────────────

  async templates(format: 'json' | 'csv' = 'json') {
    const rows = [];
    for (const d of this.hub.waTemplates.list()) {
      const st = await this.hub.templateStore.get(d.metaName, d.language);
      rows.push({ key: d.key, templateId: d.templateId, language: d.language, metaName: d.metaName, category: d.category, enabled: d.enabled, status: st?.status ?? 'DRAFT', metaTemplateId: st?.metaTemplateId ?? null, quality: st?.quality ?? null, reason: st?.reason ?? null, paramOrder: d.paramOrder, body: d.body });
    }
    return format === 'csv' ? templatesCsv(rows) : rows;
  }
  /** The approval pack: one Graph payload per template and language. Paste into the Meta Business Manager, or call submit(). */
  exportTemplates() { return this.hub.waTemplates.exportForSubmission(); }

  /** Pull statuses and ids from Meta (`GET /{waba}/message_templates`, read only). Unknown templates are ignored. */
  async syncTemplates(actor: string, market = 'EG') {
    const conf = await this.hub.config(market); const waba = conf.channels?.WHATSAPP?.wabaId;
    if (this.hub.channelMode('WHATSAPP') !== 'real') throw badRequest('MODE_MOCK', 'WHATSAPP_MODE is mock: nothing to sync');
    if (!waba) throw badRequest('WABA_NOT_CONFIGURED', 'channels.WHATSAPP.wabaId is not configured');
    const e = providerEnvFor('WHATSAPP', 'meta', conf); let updated = 0; let seen = 0;
    let path: string | null = `/${waba}/message_templates?limit=200&fields=name,language,status,category,id,quality_score,rejected_reason`;
    for (let page = 0; path && page < 20; page++) {
      const r = await providerRequest({ ...e, maxRetries: 1 }, { method: 'GET', path }, this.http, bearer(e.apiKey));
      for (const t of r.json?.data ?? []) { seen++; if (await this.hub.templateStore.apply({ metaName: String(t.name), language: String(t.language).slice(0, 2), status: statusFromMetaEvent(String(t.status).toUpperCase()), metaTemplateId: String(t.id), quality: t.quality_score?.score ? String(t.quality_score.score) : undefined, reason: t.rejected_reason && t.rejected_reason !== 'NONE' ? String(t.rejected_reason) : '', at: new Date(this.now()) })) updated++; }
      const next: string | undefined = r.json?.paging?.next; path = next ? next.replace(/^https:\/\/[^/]+\/v\d+\.\d+/, '') : null;
    }
    await this.audit(actor, 'messaging.templates.sync', 'WHATSAPP', { seen, updated });
    return { seen, updated };
  }

  /** Create the registry rows (DRAFT) and, only with `confirm`, POST each definition to Meta for review. Names already at Meta (error 100 / 2388023) are left alone. */
  async submitTemplates(actor: string, o: { keys?: string[]; confirm?: boolean }, market = 'EG') {
    const conf = await this.hub.config(market); const waba = conf.channels?.WHATSAPP?.wabaId;
    const defs = this.hub.waTemplates.list().filter((d) => d.enabled && (!o.keys?.length || o.keys.includes(d.key)));
    for (const d of defs) await this.hub.templateStore.upsertDefinition(d);
    if (!o.confirm) return { dryRun: true, count: defs.length, templates: defs.map((d) => ({ key: d.key, language: d.language, metaName: d.metaName, category: d.category })) };
    if (this.hub.channelMode('WHATSAPP') !== 'real' || !waba) throw badRequest('NOT_READY', 'WHATSAPP_MODE=real and channels.WHATSAPP.wabaId are required to submit');
    const e = providerEnvFor('WHATSAPP', 'meta', conf); const results: Array<{ key: string; language: string; ok: boolean; error?: string }> = [];
    for (const d of defs) {
      try {
        const r = await providerRequest({ ...e, maxRetries: 0 }, { path: `/${waba}/message_templates`, body: metaTemplateSubmission({ name: d.metaName, language: d.language, category: d.category, body: d.body, examples: d.examples, ...(d.quickReplies ? { quickReplies: d.quickReplies } : {}) }) }, this.http, bearer(e.apiKey));
        await this.hub.templateStore.apply({ metaName: d.metaName, language: d.language, status: 'SUBMITTED', metaTemplateId: r.json?.id ? String(r.json.id) : undefined, at: new Date(this.now()) });
        results.push({ key: d.key, language: d.language, ok: true });
      } catch (err) { results.push({ key: d.key, language: d.language, ok: false, error: err instanceof ProviderError ? `${err.message}${err.vendorCode ? `:${err.vendorCode}` : ''}` : 'FAILED' }); }
    }
    await this.audit(actor, 'messaging.templates.submit', 'WHATSAPP', { count: results.length, ok: results.filter((r) => r.ok).length });
    return { dryRun: false, results };
  }
  readonly channelsList = CHANNEL_KEYS;
  readonly secretEnvName = secretEnvName;
}
