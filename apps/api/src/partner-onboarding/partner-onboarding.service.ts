import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { PARTNER_API_PATH, deriveIntakeSigningKey, generateIntakeKey, verifyIntakeSignature } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { decryptField, encryptField } from '../common/crypto';
import { ApiError, badRequest, conflict, forbidden, notFound } from '../common/errors';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../common/rate-limit';
import { newId } from '../common/ids';
import { verifyWebhook } from '../common/hmac';
import { PartnerHttpError, PartnerTransientError, partnerRequest, type PartnerConn } from '../common/partner-http';
import { PrismaService } from '../prisma/prisma.service';
import { FlagsService } from '../control-plane/control-plane-public';
import { CatalogService } from '../catalog/catalog-public';
import { KiorlyClient, KiorlyHttpError } from '../kiorly/kiorly-public';
import { MessagingHub } from '../messaging/messaging-public';
import { MarketService } from '../market/market-public';
import { PartnerRegistry } from '../partners/partners-public';
import { parseIntakeBody, type IntakeBody } from './intake-validation';
import { KIND_FLAGS, computeSteps, goLiveBlockers, needsHandshakeCreds, progressPct, type CheckResult, type ChecksDoc, type ConnKind, type HumanDoc, type StepInput } from './steps';

/** Secrets never leave this service: the view below omits `secretsEnc` / `pendingSecretsEnc`, logs carry ids and codes only. */
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const eq = (a: string, b: string) => a.length === b.length && timingSafeEqual(Buffer.from(a), Buffer.from(b));
export type { IntakeBody };
/** Shared across API instances (Postgres). Memory only when RATE_LIMIT_STORE=memory (unit tests / throw-away runs); replaced by the Pg limiter when the service starts. */
let limiter: RateLimiter = new SlidingWindowLimiter();
/** Tests only: forget every intake counter. */
export const resetIntakeLimits = async () => { await limiter.reset(); };
const tooMany = (retryAfterSec: number) => new ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec });
const UNAUTHORIZED = () => new ApiError(401, 'INTAKE_UNAUTHORIZED', 'Request could not be authenticated');
const DUMMY_KEY = deriveIntakeSigningKey('kiorex-intake-dummy');

const MSG: Record<string, { en: string; ar: string }> = {
  SUBMITTED: { en: 'We received your request to connect to Kiorex. Our team reviews it in the Kiorex console; you can follow every step in your product settings.', ar: 'استلمنا طلب الربط بكيوريكس. يراجعه فريقنا، ويمكنك متابعة كل خطوة من إعدادات منتجك.' },
  CHANGES_REQUESTED: { en: 'Kiorex needs a change before connecting your organisation. Open Connect to Kiorex in your settings for details.', ar: 'يحتاج كيوريكس إلى تعديل قبل ربط منشأتك. افتح الربط بكيوريكس في الإعدادات للتفاصيل.' },
  REJECTED: { en: 'Your Kiorex connection request was not approved. Open Connect to Kiorex in your settings for the reason.', ar: 'لم تتم الموافقة على طلب الربط بكيوريكس. افتح الربط بكيوريكس في الإعدادات لمعرفة السبب.' },
  LIVE: { en: 'You are live on Kiorex. Patients can now find and book with you.', ar: 'أنت الآن على كيوريكس. يمكن للمرضى العثور عليك والحجز عندك.' },
  PAUSED: { en: 'Your Kiorex listing is paused. Open Connect to Kiorex in your settings for details.', ar: 'تم إيقاف ظهورك على كيوريكس مؤقتا. افتح الربط بكيوريكس في الإعدادات للتفاصيل.' },
};

@Injectable()
export class PartnerOnboardingService implements OnModuleInit, OnModuleDestroy {
  private sweepTimer?: NodeJS.Timeout;
  private readonly log = new Logger('partner-onboarding');
  constructor(
    private readonly prisma: PrismaService, private readonly flags: FlagsService, private readonly registry: PartnerRegistry, private readonly kiorly: KiorlyClient,
    private readonly catalog: CatalogService, private readonly hub: MessagingHub, private readonly markets: MarketService,
  ) {
    limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as any);
  }
  onModuleInit() {
    if (!cfg().jobsEnabled || !(limiter instanceof PgRateLimiter)) return;
    const pg = limiter;
    this.sweepTimer = setInterval(() => void pg.sweep().catch((e) => this.log.warn(`rate-limit sweep failed: ${e.message}`)), 10 * 60_000);
    this.sweepTimer.unref();
    void this.prisma.partnerIntakeNonce.deleteMany({ where: { seenAt: { lt: new Date(Date.now() - 3_600_000) } } }).catch(() => undefined);
  }
  onModuleDestroy() { if (this.sweepTimer) clearInterval(this.sweepTimer); }

  private audit(actor: string, action: string, id: string, metadata?: object) { return this.prisma.auditLog.create({ data: { actor, action: `partner_onboarding.${action}`, resource: 'PartnerConnection', resourceId: id, metadata: metadata as any } }); }
  private async row(id: string) { const r = await this.prisma.partnerConnection.findUnique({ where: { id } }); if (!r) throw notFound('PARTNER_CONNECTION_NOT_FOUND', 'Connection request not found'); return r; }
  private input(r: Awaited<ReturnType<PartnerOnboardingService['row']>>): StepInput {
    return { kind: r.kind as ConnKind, status: r.status, checks: (r.checks ?? {}) as ChecksDoc, human: (r.human ?? {}) as HumanDoc, requestedBy: r.requestedBy, approvedBy: r.approvedBy, hasRegistration: !!r.registrationId };
  }

  /** What the console and the partner see. No secrets, no PHI. */
  view(r: Awaited<ReturnType<PartnerOnboardingService['row']>>) {
    const input = this.input(r); const steps = computeSteps(input);
    return {
      id: r.id, kind: r.kind, orgRef: r.orgRef, name: r.name, nameAr: r.nameAr, market: r.market, baseUrl: r.baseUrl, clientKey: r.clientKey, status: r.status, decisionReason: r.decisionReason,
      readiness: r.readiness, checksRunAt: r.checksRunAt, requestedBy: r.requestedBy, approvedBy: r.approvedBy, liveAt: r.liveAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
      rotationPending: !!r.pendingSecretsEnc, steps, progress: progressPct(steps), blockers: goLiveBlockers(input), humanActions: steps.filter((s) => s.type === 'HUMAN' && s.state === 'ACTION').map((s) => s.key),
    };
  }

  // ───────────────────────── public intake (partner products) ─────────────────────────

  /**
   * Public intake (contracts 1.9.0). Order: shape (strict, 400) -> rate limits (429) -> authentication (ONE uniform 401 for every failure: unknown, expired,
   * used, revoked or wrong-kind enrolment, bad signature, stale timestamp, replayed nonce) -> business logic. The first request of an organisation is signed with a
   * one-time enrolment code and answers with an intake key (shown once) that signs every later request. Audit lines carry ids and codes only (no PHI, no secrets).
   */
  async intake(raw: string, h: { signature?: string; timestamp?: string; enrolment?: string; ip?: string }) {
    const c = cfg(); const ip = h.ip ?? 'unknown';
    const blockedFails = await limiter.blocked(`fail:${ip}`, c.intakeFailedPer10Min, 600_000);
    if (!blockedFails.ok) throw tooMany(blockedFails.retryAfterSec);
    const ipHit = await limiter.hit(`post:${ip}`, c.intakeIpPerMin, 60_000); if (!ipHit.ok) throw tooMany(ipHit.retryAfterSec);
    const b = parseIntakeBody(raw);
    const orgHit = await limiter.hit(`org:${b.kind}:${b.orgRef}`, c.intakeOrgPerHour, 3_600_000); if (!orgHit.ok) throw tooMany(orgHit.retryAfterSec);
    const existing = await this.prisma.partnerConnection.findUnique({ where: { kind_orgRef: { kind: b.kind, orgRef: b.orgRef } } });
    const auth = await this.authenticateIntake(b, raw, h, existing, ip);
    // Founder decision A (27 Nov 2026): a provider belongs to its country for life. A re-submit may repeat the market it registered under (or omit it) but never change it.
    const market = ((b.market ?? existing?.market ?? 'EG') as string).toUpperCase().slice(0, 2);
    if (existing && b.market !== undefined && market !== existing.market) {
      await this.audit('partner', 'market_change_refused', existing.id, { kind: existing.kind, from: existing.market, to: market });
      throw conflict('MARKET_IMMUTABLE', 'An organisation belongs to its country for life; its market cannot be changed', { market: existing.market });
    }
    let secretsEnc: string | undefined; const baseUrl = b.baseUrl;
    if (needsHandshakeCreds(b.kind)) secretsEnc = encryptField(JSON.stringify({ clientSecret: b.clientSecret, webhookSecret: b.webhookSecret }));
    const readiness = { ...(b.readiness ?? {}), locale: b.locale === 'ar' ? 'ar' : 'en' };
    if (!existing) {
      // a partner may derive its own status token (so it never has to store one); otherwise we mint one and return it once
      const supplied = typeof b.statusToken === 'string' && b.statusToken.length >= 32 && b.statusToken.length <= 128 ? b.statusToken : undefined;
      const token = supplied ?? randomBytes(24).toString('base64url');
      const issued = generateIntakeKey();
      const r = await this.prisma.$transaction(async (tx) => {
        await this.consumeEnrolment(tx, auth, null);
        return tx.partnerConnection.create({ data: { id: newId('pc'), kind: b.kind, orgRef: b.orgRef, name: b.name, nameAr: b.nameAr, market, contactEmail: b.contactEmail, baseUrl, clientKey: b.clientKey, secretsEnc, statusTokenHash: sha(token), readiness, intakeKeyHash: issued.signingKey } });
      });
      if (auth.enrolmentId) await this.prisma.partnerEnrolment.update({ where: { id: auth.enrolmentId }, data: { connectionId: r.id } }).catch(() => undefined);
      await this.audit('partner', 'submitted', r.id, { kind: r.kind, market });
      void this.notify(r, 'SUBMITTED');
      void this.runChecks('system', r.id).catch((e) => this.log.warn(`auto checks failed id=${r.id} err=${(e as Error).name}`));
      await this.audit('partner', 'enrolment_used', r.id, { enrolmentId: auth.enrolmentId });
      return { id: r.id, status: r.status, ...(supplied ? {} : { statusToken: token }), intakeKey: issued.key, created: true };
    }
    // idempotent re-submit: refresh readiness; a changed credential set while LIVE is a rotation that ops applies after a passing handshake
    const data: Record<string, unknown> = { name: b.name, nameAr: b.nameAr, market, contactEmail: b.contactEmail ?? existing.contactEmail, readiness };
    if (needsHandshakeCreds(b.kind) && secretsEnc) {
      if (existing.registrationId) { // registered: a changed credential set is a rotation that ops applies after a passing handshake
        const reg = await this.prisma.partnerRegistration.findUnique({ where: { id: existing.registrationId } });
        const changed = !reg || reg.clientKey !== b.clientKey || reg.baseUrl !== baseUrl || decryptField(reg.clientSecretEnc) !== b.clientSecret || decryptField(reg.webhookSecretEnc) !== b.webhookSecret;
        if (changed) data.pendingSecretsEnc = encryptField(JSON.stringify({ clientKey: b.clientKey, baseUrl, clientSecret: b.clientSecret, webhookSecret: b.webhookSecret }));
      } else { data.baseUrl = baseUrl; data.clientKey = b.clientKey; data.secretsEnc = secretsEnc; }
    }
    if (existing.status === 'CHANGES_REQUESTED') data.status = 'SUBMITTED';
    // recovery re-enrolment (ops issued a new code because the partner lost its intake key): a new key replaces the old one
    const reissued = auth.enrolmentId ? generateIntakeKey() : undefined;
    if (reissued) data.intakeKeyHash = reissued.signingKey;
    const r = await this.prisma.$transaction(async (tx) => { await this.consumeEnrolment(tx, auth, existing.id); return tx.partnerConnection.update({ where: { id: existing.id }, data }); });
    await this.audit('partner', data.pendingSecretsEnc ? 'rotation_submitted' : 'resubmitted', r.id, auth.enrolmentId ? { enrolmentId: auth.enrolmentId } : undefined);
    void this.runChecks('system', r.id).catch(() => undefined);
    return { id: r.id, status: r.status, created: false, ...(reissued ? { intakeKey: reissued.key } : {}) };
  }

  /** One uniform failure for every reason; the reason is audited internally (ids only) and never returned. */
  private async authenticateIntake(b: IntakeBody, raw: string, h: { signature?: string; timestamp?: string; enrolment?: string }, existing: { id: string; intakeKeyHash: string | null } | null, ip: string): Promise<{ enrolmentId?: string }> {
    const now = new Date(); let key = DUMMY_KEY; let enrolmentId: string | undefined; let reason = 'NO_CREDENTIAL';
    const enrId = typeof h.enrolment === 'string' && /^kxe_[A-Za-z0-9_-]{8,16}$/.test(h.enrolment) ? h.enrolment : undefined;
    if (enrId) {
      const e = await this.prisma.partnerEnrolment.findUnique({ where: { id: enrId } });
      if (!e) reason = 'ENROLMENT_UNKNOWN';
      else if (e.status === 'REVOKED') reason = 'ENROLMENT_REVOKED';
      else if (e.status === 'USED') reason = 'ENROLMENT_USED';
      else if (e.expiresAt <= now) reason = 'ENROLMENT_EXPIRED';
      else if (e.kind !== b.kind || (e.orgRef && e.orgRef !== b.orgRef)) reason = 'ENROLMENT_MISMATCH';
      else { key = e.signingKey; enrolmentId = e.id; reason = 'OK'; }
    } else if (existing?.intakeKeyHash) { key = existing.intakeKeyHash; reason = 'OK'; }
    else if (existing) reason = 'NEEDS_ENROLMENT';
    const sigOk = verifyIntakeSignature({ signingKey: key, body: raw, timestamp: h.timestamp, signature: h.signature });
    if (reason === 'OK' && !sigOk) reason = 'BAD_SIGNATURE';
    if (reason === 'OK') {
      const id = sha(`${b.kind}|${b.orgRef}|${b.nonce}`);
      try { await this.prisma.partnerIntakeNonce.create({ data: { id } }); } catch { reason = 'REPLAY'; }
      if (Math.random() < 0.02) void this.prisma.partnerIntakeNonce.deleteMany({ where: { seenAt: { lt: new Date(Date.now() - 3_600_000) } } }).catch(() => undefined);
    }
    if (reason !== 'OK') {
      await limiter.hit(`fail:${ip}`, 1_000_000, 600_000);
      // audit the attempt only when it names a real enrolment or connection, and cap the lines so it cannot be used to flood the log
      const target = enrId ?? existing?.id;
      if (target && (await limiter.hit(`audit:${target}`, 10, 3_600_000)).ok) await this.audit('partner', 'intake_rejected', existing?.id ?? target, { reason, enrolmentId: enrId }).catch(() => undefined);
      throw UNAUTHORIZED();
    }
    return { enrolmentId };
  }

  /** Single use: only an ACTIVE, unexpired enrolment is consumed (atomically, in the same transaction as the connection write). */
  private async consumeEnrolment(tx: { partnerEnrolment: PrismaService['partnerEnrolment'] }, auth: { enrolmentId?: string }, connectionId: string | null) {
    if (!auth.enrolmentId) return;
    const n = await tx.partnerEnrolment.updateMany({ where: { id: auth.enrolmentId, status: 'ACTIVE', expiresAt: { gt: new Date() } }, data: { status: 'USED', usedAt: new Date(), connectionId } });
    if (n.count !== 1) throw UNAUTHORIZED();
  }

  /** Partner polls with its status token (shown once at creation). Only coarse, non-internal information is returned. */
  async partnerStatus(id: string, token: string | undefined, ip = 'unknown') {
    const c = cfg(); const a = await limiter.hit(`get:${ip}`, c.intakeStatusIpPerMin, 60_000); if (!a.ok) throw tooMany(a.retryAfterSec);
    const b = await limiter.hit(`get-id:${id.slice(0, 64)}`, 60, 60_000); if (!b.ok) throw tooMany(b.retryAfterSec);
    const r = await this.prisma.partnerConnection.findUnique({ where: { id } });
    if (!r || !token || !eq(r.statusTokenHash, sha(token))) throw notFound('PARTNER_CONNECTION_NOT_FOUND', 'Connection request not found');
    const steps = computeSteps(this.input(r));
    return { id: r.id, kind: r.kind, status: r.status, decisionReason: r.status === 'LIVE' ? null : r.decisionReason, progress: progressPct(steps), steps: steps.map((s) => ({ key: s.key, type: s.type, state: s.state })), liveAt: r.liveAt, updatedAt: r.updatedAt };
  }

  // ───────────────────────── automated checks ─────────────────────────

  private conn(r: { baseUrl: string | null; clientKey: string | null }, secret: string, kind: ConnKind): PartnerConn {
    return { baseUrl: `${(r.baseUrl ?? '').replace(/\/+$/, '')}${kind === 'PHARMACY' ? PARTNER_API_PATH.pharmacy : PARTNER_API_PATH.lab}`, clientKey: r.clientKey ?? '', clientSecret: secret, timeoutMs: cfg().partnerTimeoutMs };
  }

  /** Signed read against the partner API: proves the supplied credentials work end to end and returns the catalogue size (a dry run, nothing is imported). */
  private async handshake(kind: ConnKind, c: PartnerConn): Promise<CheckResult & { items?: number }> {
    try {
      const res = await partnerRequest<{ items?: unknown[] }>(c, { method: 'GET', path: kind === 'PHARMACY' ? '/catalogue' : '/tests' });
      return { status: 'PASSED', code: 'SIGNED_PING_OK', items: Array.isArray(res.data?.items) ? res.data.items.length : 0 };
    } catch (e) {
      if (e instanceof PartnerHttpError) {
        if (e.status === 403 && e.code === 'FEATURE_DISABLED') return { status: 'WARN', code: 'SIGNED_PING_OK_FLAG_OFF', items: 0 };
        return { status: 'FAILED', code: e.status === 401 ? 'SIGNATURE_REJECTED' : `PARTNER_HTTP_${e.status}`, detail: { partnerCode: e.code ?? null } };
      }
      if (e instanceof PartnerTransientError) return { status: 'FAILED', code: 'PARTNER_UNREACHABLE', detail: { kind: e.kind } };
      return { status: 'FAILED', code: 'PARTNER_ERROR' };
    }
  }

  /** Idempotent: re-running replaces the previous results; nothing is written outside this row (plus an audit line). */
  async runChecks(actor: string, id: string) {
    const r = await this.row(id); const kind = r.kind as ConnKind; const items: Record<string, CheckResult> = {};
    const rd = (r.readiness ?? {}) as Record<string, any>;
    // credentials
    let secrets: { clientSecret?: string } = {};
    if (needsHandshakeCreds(kind)) {
      try { secrets = r.secretsEnc ? JSON.parse(decryptField(r.secretsEnc)) : {}; } catch { secrets = {}; }
      const hasKey = !!(r.baseUrl && r.clientKey && (secrets.clientSecret || r.registrationId));
      items.credentials = hasKey ? { status: 'PASSED', code: 'CREDENTIALS_PRESENT' } : { status: 'FAILED', code: 'CREDENTIALS_MISSING' };
    } else items.credentials = { status: 'SKIPPED', code: 'SIGNED_INTAKE_VERIFIED' };
    // handshake + catalogue / provider dry run
    if (needsHandshakeCreds(kind)) {
      if (items.credentials.status !== 'PASSED') { items.handshake = { status: 'FAILED', code: 'NO_CREDENTIALS' }; items.sync_dry_run = { status: 'FAILED', code: 'NO_HANDSHAKE' }; }
      else {
        let secret = secrets.clientSecret;
        if (!secret && r.registrationId) { const reg = await this.prisma.partnerRegistration.findUnique({ where: { id: r.registrationId } }); secret = reg ? decryptField(reg.clientSecretEnc) : undefined; }
        const h = await this.handshake(kind, this.conn(r, secret ?? '', kind));
        items.handshake = { status: h.status, code: h.code, detail: h.detail };
        const n = h.items ?? 0;
        items.sync_dry_run = h.status === 'FAILED' ? { status: 'FAILED', code: 'NO_HANDSHAKE' } : n > 0 ? { status: 'PASSED', code: 'CATALOGUE_READY', detail: { items: n } } : { status: h.status === 'WARN' ? 'WARN' : 'FAILED', code: h.status === 'WARN' ? 'FLAG_OFF_COUNT_UNKNOWN' : 'EMPTY_CATALOGUE', detail: { items: 0 } };
      }
    } else {
      try {
        const res = await this.kiorly.request<{ orgRef?: string; listings?: { total?: number; ready?: number } }>({ method: 'GET', path: `/connection/${encodeURIComponent(r.orgRef)}` });
        const ok = res.data?.orgRef === r.orgRef;
        items.handshake = ok ? { status: 'PASSED', code: 'SIGNED_PING_OK' } : { status: 'FAILED', code: 'ORG_NOT_RECOGNISED' };
        const ready = res.data?.listings?.ready ?? 0;
        items.sync_dry_run = ok && ready > 0 ? { status: 'PASSED', code: 'LISTINGS_READY', detail: { total: res.data?.listings?.total ?? 0, ready } } : { status: 'FAILED', code: ok ? 'NO_READY_LISTINGS' : 'NO_HANDSHAKE', detail: { total: res.data?.listings?.total ?? 0, ready } };
      } catch (e) {
        const code = e instanceof KiorlyHttpError ? (e.status === 404 ? 'ORG_NOT_RECOGNISED' : `CLINIC_HTTP_${e.status}`) : 'CLINIC_UNREACHABLE';
        items.handshake = { status: 'FAILED', code }; items.sync_dry_run = { status: 'FAILED', code: 'NO_HANDSHAKE' };
      }
    }
    // flags + launch-gate evidence (read only: gates are only ever recorded by a human through the super-admin route)
    const gates: { flag: string; gateIds: string[]; satisfied: boolean }[] = []; const states: Record<string, string> = {}; let flagFail: string | undefined;
    for (const f of KIND_FLAGS[kind]) {
      const e = await this.flags.evaluate(f.key, { market: r.market, orgId: r.orgRef });
      states[f.key] = e.effective ? 'ON' : e.reason;
      const def = await this.prisma.flagDefinition.findUnique({ where: { key: f.key } });
      if (def?.launchLocked) gates.push({ flag: f.key, gateIds: def.gateIds, satisfied: e.reason !== 'AWAITING_GATE' });
      if (!e.effective && e.reason !== 'AWAITING_GATE' && e.reason !== 'DEPENDENCY_OFF') flagFail = flagFail ?? `FLAG_${e.reason}`;
      if (!e.effective && e.reason === 'DEPENDENCY_OFF') { const dep = e.blockedBy ?? ''; const depGate = dep && (await this.prisma.flagDefinition.findUnique({ where: { key: dep } }))?.launchLocked; if (!depGate) flagFail = flagFail ?? 'FLAG_DEPENDENCY_OFF'; }
    }
    // a satisfied gate (evidence present) whose flag is still blocked by an OFF value is a flag problem, not a gate problem
    items.flags = flagFail ? { status: 'FAILED', code: flagFail, detail: { states, gates } } : gates.some((g) => !g.satisfied) ? { status: 'WARN', code: 'AWAITING_GATE', detail: { states, gates } } : { status: 'PASSED', code: 'FLAGS_READY', detail: { states, gates } };
    // market / pack
    items.market_pack = (await this.markets.isLive(r.market)) ? { status: 'PASSED', code: 'MARKET_LIVE', detail: { market: r.market } } : { status: 'FAILED', code: 'MARKET_NOT_LIVE', detail: { market: r.market } };
    // duplicates against existing providers / registrations / other requests
    const dup: string[] = [];
    if (kind === 'CLINIC' || kind === 'NURSE') { if ((await this.prisma.provider.count({ where: { tenantId: r.orgRef, status: 'LIVE' } })) > 0 && r.status !== 'LIVE') dup.push('ALREADY_LISTED'); }
    else {
      // same API host is normal (one multi-tenant Kiorly deployment serves many organisations): the client key is the identity
      const regs = await this.prisma.partnerRegistration.findMany({ where: { kind, clientKey: r.clientKey ?? '__none__' } });
      if (regs.some((g) => g.id !== r.registrationId)) dup.push('REGISTRY_DUPLICATE');
    }
    const same = await this.prisma.partnerConnection.findMany({ where: { id: { not: r.id }, kind: r.kind, market: r.market, name: { equals: r.name, mode: 'insensitive' } }, select: { id: true } });
    if (needsHandshakeCreds(kind) && (await this.prisma.partnerRegistration.count({ where: { kind, name: { equals: r.name, mode: 'insensitive' }, ...(r.registrationId ? { id: { not: r.registrationId } } : {}) } })) > 0) same.push({ id: 'registry' });
    items.duplicates = dup.length ? { status: 'FAILED', code: dup[0], detail: { all: dup } } : same.length ? { status: 'WARN', code: 'SIMILAR_NAME', detail: { count: same.length } } : { status: 'PASSED', code: 'NO_DUPLICATES' };
    // required documents / terms (statuses reported by the product; the files themselves stay in the partner's product)
    const docs = (rd.documents ?? {}) as Record<string, boolean>; const missing: string[] = [];
    const need = kind === 'CLINIC' || kind === 'NURSE' ? ['doctorCredentials'] : ['licence'];
    for (const d of need) if (!docs[d]) missing.push(d);
    if (!rd.termsAcceptedAt) missing.push('terms');
    items.documents = missing.length ? { status: 'FAILED', code: 'DOCUMENTS_MISSING', detail: { missing } } : { status: 'PASSED', code: 'DOCUMENTS_PRESENT' };
    const doc: ChecksDoc = { ranAt: new Date().toISOString(), items };
    // only the checks document is written from this (possibly stale) read; SUBMITTED -> IN_REVIEW is a guarded transition so a decision taken meanwhile is never overwritten
    await this.prisma.partnerConnection.update({ where: { id }, data: { checks: doc as any, checksRunAt: new Date() } });
    const moved = (await this.prisma.partnerConnection.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'IN_REVIEW' } })).count > 0;
    const upd = await this.row(id);
    await this.audit(actor, 'checks_run', id, { failed: Object.entries(items).filter(([, v]) => v.status === 'FAILED').map(([k]) => k) });
    if (moved) void this.pushToClinic(upd, 'IN_REVIEW').catch(() => undefined);
    return this.view(upd);
  }

  // ───────────────────────── human steps ─────────────────────────

  private async mutateHuman(actor: string, id: string, step: string, patch: Partial<HumanDoc>) {
    const r = await this.row(id);
    if (['LIVE', 'REJECTED'].includes(r.status)) throw conflict('CONNECTION_LOCKED', 'This connection can no longer change', { status: r.status });
    const human = { ...((r.human ?? {}) as HumanDoc), ...patch };
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { human: human as any, ...(r.status === 'AWAITING_APPROVAL' ? { status: 'IN_REVIEW', requestedBy: null } : {}) } });
    await this.audit(actor, `step_${step}`, id);
    return this.view(u);
  }
  async reviewDocuments(actor: string, id: string, note?: string) {
    const r = await this.row(id);
    if ((r.checks as ChecksDoc)?.items?.documents?.status !== 'PASSED') throw conflict('DOCUMENTS_CHECK_REQUIRED', 'Documents must be present (automated check) before a human reviews them');
    return this.mutateHuman(actor, id, 'review_documents', { documents: { by: actor, at: new Date().toISOString(), note: note?.slice(0, 200) } });
  }
  async verifyLicence(actor: string, id: string, reference: string) {
    if (!reference || reference.trim().length < 3) throw badRequest('LICENCE_REFERENCE_REQUIRED', 'Enter the licence / registration reference you verified');
    return this.mutateHuman(actor, id, 'verify_licence', { licence: { by: actor, at: new Date().toISOString(), reference: reference.trim().slice(0, 80) } });
  }
  async confirmFees(actor: string, id: string, mode: 'STANDARD' | 'ORG_OVERRIDE', note?: string) {
    if (mode !== 'STANDARD' && mode !== 'ORG_OVERRIDE') throw badRequest('INVALID_FEE_MODE', 'mode must be STANDARD or ORG_OVERRIDE');
    if (mode === 'ORG_OVERRIDE' && !note?.trim()) throw badRequest('FEE_NOTE_REQUIRED', 'Say which organisation-scope policy override was set (Policy page) and why');
    return this.mutateHuman(actor, id, 'fees', { fees: { by: actor, at: new Date().toISOString(), mode, note: note?.slice(0, 200) } });
  }

  async requestChanges(actor: string, id: string, reason: string) {
    if (!reason?.trim()) throw badRequest('REASON_REQUIRED', 'A reason is required');
    const r = await this.row(id); if (['LIVE', 'REJECTED'].includes(r.status)) throw conflict('CONNECTION_LOCKED', 'This connection can no longer change');
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'CHANGES_REQUESTED', decisionReason: reason.trim().slice(0, 300), requestedBy: null } });
    await this.audit(actor, 'changes_requested', id); void this.notify(u, 'CHANGES_REQUESTED'); void this.pushToClinic(u, 'CHANGES_REQUESTED').catch(() => undefined);
    return this.view(u);
  }
  async reject(actor: string, id: string, reason: string) {
    if (!reason?.trim()) throw badRequest('REASON_REQUIRED', 'A reason is required');
    const r = await this.row(id); if (r.status === 'LIVE') throw conflict('CONNECTION_LOCKED', 'Pause a live connection instead of rejecting it');
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'REJECTED', decisionReason: reason.trim().slice(0, 300), secretsEnc: null } });
    await this.audit(actor, 'rejected', id); void this.notify(u, 'REJECTED'); void this.pushToClinic(u, 'REJECTED').catch(() => undefined);
    return this.view(u);
  }

  /** Two-person rule: ops prepares and requests; a DIFFERENT super admin approves (also not the person who verified the licence). */
  async requestApproval(actor: string, id: string) {
    const r = await this.row(id);
    if (!['IN_REVIEW', 'SUBMITTED'].includes(r.status)) throw conflict('INVALID_STATE', 'Only a connection in review can be sent for approval', { status: r.status });
    const input = this.input(r); const open = computeSteps(input).filter((s) => !['approval', 'go_live'].includes(s.key) && s.state !== 'DONE' && s.state !== 'WARN').map((s) => s.key);
    if (open.length) throw conflict('STEPS_OPEN', 'Finish every automated check and human step first', { open });
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'AWAITING_APPROVAL', requestedBy: actor } });
    await this.audit(actor, 'approval_requested', id); return this.view(u);
  }
  async approve(actor: string, id: string) {
    const r = await this.row(id);
    if (r.status !== 'AWAITING_APPROVAL') throw conflict('INVALID_STATE', 'Nothing awaits approval', { status: r.status });
    const licBy = ((r.human ?? {}) as HumanDoc).licence?.by;
    if (r.requestedBy === actor || licBy === actor) throw forbidden('TWO_PERSON_RULE', 'Approval needs a different person than the requester and the licence verifier');
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date(), decisionReason: null } });
    await this.audit(actor, 'approved', id); return this.view(u);
  }

  /** One-click Go live: only when every gate is green. PHARMACY/LAB: registry credentials become active (secrets wiped from the request), partner flags ensured ON. CLINIC/NURSE: Kiorly is told over the signed marketplace API and listings recompute to LIVE. */
  async goLive(actor: string, id: string) {
    const r = await this.row(id);
    if (r.status === 'LIVE') return this.view(r); // idempotent
    const blockers = goLiveBlockers(this.input(r));
    if (blockers.length) throw conflict('GO_LIVE_BLOCKED', 'Every automated check and human step must be green', { blockers });
    const kind = r.kind as ConnKind;
    if (needsHandshakeCreds(kind)) {
      let regId = r.registrationId;
      if (!regId) {
        const s = JSON.parse(decryptField(r.secretsEnc!));
        const reg = await this.registry.upsert(kind.toLowerCase(), undefined, { name: r.name, baseUrl: r.baseUrl!, clientKey: r.clientKey!, clientSecret: s.clientSecret, webhookSecret: s.webhookSecret, active: true });
        regId = reg.id;
      } else await this.registry.upsert(kind.toLowerCase(), regId, { active: true });
      await this.prisma.partnerConnection.update({ where: { id }, data: { registrationId: regId, secretsEnc: null } });
    }
    for (const f of KIND_FLAGS[kind].filter((x) => !x.launchLocked)) {
      const def = await this.prisma.flagDefinition.findUnique({ where: { key: f.key } });
      if (def?.scopes.includes('ORG')) await this.flags.setValue(actor, { key: f.key, scope: 'ORG', scopeId: r.orgRef, value: 'ON', reason: 'Partner connection go-live', ticket: id });
    }
    if (!needsHandshakeCreds(kind)) {
      try { await this.kiorly.request({ method: 'PUT', path: `/connection/${encodeURIComponent(r.orgRef)}`, body: { decision: 'APPROVED', connectionId: id } }); }
      catch (e) { throw new ApiError(503, 'CLINIC_NOTIFY_FAILED', 'Kiorly could not be told about the approval; nothing changed, retry Go live', { cause: e instanceof KiorlyHttpError ? `HTTP_${e.status}` : 'UNREACHABLE' }); }
      void this.catalog.syncOnce().catch(() => undefined);
    }
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'LIVE', liveAt: new Date(), decisionReason: null } });
    await this.audit(actor, 'went_live', id); void this.notify(u, 'LIVE');
    return this.view(u);
  }

  async pause(actor: string, id: string, reason: string) {
    if (!reason?.trim()) throw badRequest('REASON_REQUIRED', 'A reason is required');
    const r = await this.row(id); if (r.status !== 'LIVE') throw conflict('INVALID_STATE', 'Only a live connection can be paused');
    if (r.registrationId) await this.registry.upsert(r.kind.toLowerCase(), r.registrationId, { active: false });
    if (r.kind === 'CLINIC' || r.kind === 'NURSE') await this.pushToClinic(r, 'PAUSED', reason).catch(() => undefined);
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'PAUSED', decisionReason: reason.trim().slice(0, 300) } });
    await this.audit(actor, 'paused', id); void this.notify(u, 'PAUSED'); return this.view(u);
  }
  async resume(actor: string, id: string) {
    const r = await this.row(id); if (r.status !== 'PAUSED') throw conflict('INVALID_STATE', 'Only a paused connection can resume');
    if (r.registrationId) await this.registry.upsert(r.kind.toLowerCase(), r.registrationId, { active: true });
    if (r.kind === 'CLINIC' || r.kind === 'NURSE') await this.pushToClinic(r, 'APPROVED').catch(() => undefined);
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'LIVE', decisionReason: null } });
    await this.audit(actor, 'resumed', id); void this.notify(u, 'LIVE'); return this.view(u);
  }

  /** Credential rotation (PHARMACY/LAB): new credentials submitted by the partner replace the registry secrets only after a passing signed handshake. */
  async applyRotation(actor: string, id: string) {
    const r = await this.row(id); if (!r.pendingSecretsEnc || !r.registrationId) throw conflict('NO_ROTATION_PENDING', 'No credential rotation is waiting');
    const p = JSON.parse(decryptField(r.pendingSecretsEnc)) as { clientKey: string; baseUrl: string; clientSecret: string; webhookSecret: string };
    const h = await this.handshake(r.kind as ConnKind, this.conn({ baseUrl: p.baseUrl, clientKey: p.clientKey }, p.clientSecret, r.kind as ConnKind));
    if (h.status === 'FAILED') throw conflict('ROTATION_HANDSHAKE_FAILED', 'The new credentials did not pass the signed handshake; the current ones stay active', { code: h.code });
    await this.registry.upsert(r.kind.toLowerCase(), r.registrationId, { baseUrl: p.baseUrl, clientKey: p.clientKey, clientSecret: p.clientSecret, webhookSecret: p.webhookSecret });
    const u = await this.prisma.partnerConnection.update({ where: { id }, data: { pendingSecretsEnc: null, clientKey: p.clientKey, baseUrl: p.baseUrl } });
    await this.audit(actor, 'rotation_applied', id); return this.view(u);
  }

  // ───────────────────────── reads ─────────────────────────

  async list(q: { status?: string; kind?: string } = {}) {
    const rows = await this.prisma.partnerConnection.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    return rows.map((r) => { const v = this.view(r); return { id: v.id, kind: v.kind, name: v.name, nameAr: v.nameAr, market: v.market, status: v.status, progress: v.progress, humanActions: v.humanActions, createdAt: v.createdAt, updatedAt: v.updatedAt }; });
  }
  async get(id: string) { return this.view(await this.row(id)); }
  async auditTrail(id: string) { await this.row(id); return (await this.prisma.auditLog.findMany({ where: { resource: 'PartnerConnection', resourceId: id }, orderBy: { createdAt: 'asc' }, take: 200 })).map((a) => ({ id: a.id, actor: a.actor, action: a.action.replace('partner_onboarding.', ''), createdAt: a.createdAt, metadata: a.metadata })); }

  // ───────────────────────── outbound: notifications (mock layer) and clinic push ─────────────────────────

  private async notify(r: { id: string; name: string; contactEmail: string | null; readiness: unknown }, event: keyof typeof MSG) {
    if (!r.contactEmail) return;
    const locale = (r.readiness as any)?.locale === 'ar' ? 'ar' : 'en';
    try { await this.hub.send({ channel: 'EMAIL', to: r.contactEmail, templateId: `partner.onboarding.${event.toLowerCase()}`, locale, subject: locale === 'ar' ? 'الربط بكيوريكس' : 'Connect to Kiorex', body: MSG[event][locale], data: { connectionId: r.id } }); }
    catch { this.log.warn(`notify failed id=${r.id} event=${event}`); }
  }
  private async pushToClinic(r: { id: string; kind: string; orgRef: string }, decision: string, reason?: string) {
    if (r.kind !== 'CLINIC' && r.kind !== 'NURSE') return;
    await this.kiorly.request({ method: 'PUT', path: `/connection/${encodeURIComponent(r.orgRef)}`, body: { decision, connectionId: r.id, ...(reason ? { reasonCode: 'OPS_NOTE' } : {}) } });
  }
}
