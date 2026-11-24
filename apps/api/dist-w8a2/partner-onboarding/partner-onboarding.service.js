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
exports.PartnerOnboardingService = exports.resetIntakeLimits = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("@kiorex/contracts");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const rate_limit_1 = require("../common/rate-limit");
const ids_1 = require("../common/ids");
const partner_http_1 = require("../common/partner-http");
const prisma_service_1 = require("../prisma/prisma.service");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const catalog_public_1 = require("../catalog/catalog-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const messaging_public_1 = require("../messaging/messaging-public");
const market_public_1 = require("../market/market-public");
const partners_public_1 = require("../partners/partners-public");
const intake_validation_1 = require("./intake-validation");
const steps_1 = require("./steps");
const sha = (s) => (0, node_crypto_1.createHash)('sha256').update(s).digest('hex');
const eq = (a, b) => a.length === b.length && (0, node_crypto_1.timingSafeEqual)(Buffer.from(a), Buffer.from(b));
let limiter = new rate_limit_1.SlidingWindowLimiter();
const resetIntakeLimits = async () => { await limiter.reset(); };
exports.resetIntakeLimits = resetIntakeLimits;
const tooMany = (retryAfterSec) => new errors_1.ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec });
const UNAUTHORIZED = () => new errors_1.ApiError(401, 'INTAKE_UNAUTHORIZED', 'Request could not be authenticated');
const DUMMY_KEY = (0, contracts_1.deriveIntakeSigningKey)('kiorex-intake-dummy');
const MSG = {
    SUBMITTED: { en: 'We received your request to connect to Kiorex. Our team reviews it in the Kiorex console; you can follow every step in your product settings.', ar: 'استلمنا طلب الربط بكيوريكس. يراجعه فريقنا، ويمكنك متابعة كل خطوة من إعدادات منتجك.' },
    CHANGES_REQUESTED: { en: 'Kiorex needs a change before connecting your organisation. Open Connect to Kiorex in your settings for details.', ar: 'يحتاج كيوريكس إلى تعديل قبل ربط منشأتك. افتح الربط بكيوريكس في الإعدادات للتفاصيل.' },
    REJECTED: { en: 'Your Kiorex connection request was not approved. Open Connect to Kiorex in your settings for the reason.', ar: 'لم تتم الموافقة على طلب الربط بكيوريكس. افتح الربط بكيوريكس في الإعدادات لمعرفة السبب.' },
    LIVE: { en: 'You are live on Kiorex. Patients can now find and book with you.', ar: 'أنت الآن على كيوريكس. يمكن للمرضى العثور عليك والحجز عندك.' },
    PAUSED: { en: 'Your Kiorex listing is paused. Open Connect to Kiorex in your settings for details.', ar: 'تم إيقاف ظهورك على كيوريكس مؤقتا. افتح الربط بكيوريكس في الإعدادات للتفاصيل.' },
};
let PartnerOnboardingService = class PartnerOnboardingService {
    prisma;
    flags;
    registry;
    kiorly;
    catalog;
    hub;
    markets;
    sweepTimer;
    log = new common_1.Logger('partner-onboarding');
    constructor(prisma, flags, registry, kiorly, catalog, hub, markets) {
        this.prisma = prisma;
        this.flags = flags;
        this.registry = registry;
        this.kiorly = kiorly;
        this.catalog = catalog;
        this.hub = hub;
        this.markets = markets;
        limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new rate_limit_1.SlidingWindowLimiter() : new rate_limit_1.PgRateLimiter(prisma);
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled || !(limiter instanceof rate_limit_1.PgRateLimiter))
            return;
        const pg = limiter;
        this.sweepTimer = setInterval(() => void pg.sweep().catch((e) => this.log.warn(`rate-limit sweep failed: ${e.message}`)), 10 * 60_000);
        this.sweepTimer.unref();
        void this.prisma.partnerIntakeNonce.deleteMany({ where: { seenAt: { lt: new Date(Date.now() - 3_600_000) } } }).catch(() => undefined);
    }
    onModuleDestroy() { if (this.sweepTimer)
        clearInterval(this.sweepTimer); }
    audit(actor, action, id, metadata) { return this.prisma.auditLog.create({ data: { actor, action: `partner_onboarding.${action}`, resource: 'PartnerConnection', resourceId: id, metadata: metadata } }); }
    async row(id) { const r = await this.prisma.partnerConnection.findUnique({ where: { id } }); if (!r)
        throw (0, errors_1.notFound)('PARTNER_CONNECTION_NOT_FOUND', 'Connection request not found'); return r; }
    input(r) {
        return { kind: r.kind, status: r.status, checks: (r.checks ?? {}), human: (r.human ?? {}), requestedBy: r.requestedBy, approvedBy: r.approvedBy, hasRegistration: !!r.registrationId };
    }
    view(r) {
        const input = this.input(r);
        const steps = (0, steps_1.computeSteps)(input);
        return {
            id: r.id, kind: r.kind, orgRef: r.orgRef, name: r.name, nameAr: r.nameAr, market: r.market, baseUrl: r.baseUrl, clientKey: r.clientKey, status: r.status, decisionReason: r.decisionReason,
            readiness: r.readiness, checksRunAt: r.checksRunAt, requestedBy: r.requestedBy, approvedBy: r.approvedBy, liveAt: r.liveAt, createdAt: r.createdAt, updatedAt: r.updatedAt,
            rotationPending: !!r.pendingSecretsEnc, steps, progress: (0, steps_1.progressPct)(steps), blockers: (0, steps_1.goLiveBlockers)(input), humanActions: steps.filter((s) => s.type === 'HUMAN' && s.state === 'ACTION').map((s) => s.key),
        };
    }
    async intake(raw, h) {
        const c = (0, config_1.cfg)();
        const ip = h.ip ?? 'unknown';
        const blockedFails = await limiter.blocked(`fail:${ip}`, c.intakeFailedPer10Min, 600_000);
        if (!blockedFails.ok)
            throw tooMany(blockedFails.retryAfterSec);
        const ipHit = await limiter.hit(`post:${ip}`, c.intakeIpPerMin, 60_000);
        if (!ipHit.ok)
            throw tooMany(ipHit.retryAfterSec);
        const b = (0, intake_validation_1.parseIntakeBody)(raw);
        const orgHit = await limiter.hit(`org:${b.kind}:${b.orgRef}`, c.intakeOrgPerHour, 3_600_000);
        if (!orgHit.ok)
            throw tooMany(orgHit.retryAfterSec);
        const existing = await this.prisma.partnerConnection.findUnique({ where: { kind_orgRef: { kind: b.kind, orgRef: b.orgRef } } });
        const auth = await this.authenticateIntake(b, raw, h, existing, ip);
        const market = (b.market ?? 'EG').toUpperCase().slice(0, 2);
        let secretsEnc;
        const baseUrl = b.baseUrl;
        if ((0, steps_1.needsHandshakeCreds)(b.kind))
            secretsEnc = (0, crypto_1.encryptField)(JSON.stringify({ clientSecret: b.clientSecret, webhookSecret: b.webhookSecret }));
        const readiness = { ...(b.readiness ?? {}), locale: b.locale === 'ar' ? 'ar' : 'en' };
        if (!existing) {
            const supplied = typeof b.statusToken === 'string' && b.statusToken.length >= 32 && b.statusToken.length <= 128 ? b.statusToken : undefined;
            const token = supplied ?? (0, node_crypto_1.randomBytes)(24).toString('base64url');
            const issued = (0, contracts_1.generateIntakeKey)();
            const r = await this.prisma.$transaction(async (tx) => {
                await this.consumeEnrolment(tx, auth, null);
                return tx.partnerConnection.create({ data: { id: (0, ids_1.newId)('pc'), kind: b.kind, orgRef: b.orgRef, name: b.name, nameAr: b.nameAr, market, contactEmail: b.contactEmail, baseUrl, clientKey: b.clientKey, secretsEnc, statusTokenHash: sha(token), readiness, intakeKeyHash: issued.signingKey } });
            });
            if (auth.enrolmentId)
                await this.prisma.partnerEnrolment.update({ where: { id: auth.enrolmentId }, data: { connectionId: r.id } }).catch(() => undefined);
            await this.audit('partner', 'submitted', r.id, { kind: r.kind, market });
            void this.notify(r, 'SUBMITTED');
            void this.runChecks('system', r.id).catch((e) => this.log.warn(`auto checks failed id=${r.id} err=${e.name}`));
            await this.audit('partner', 'enrolment_used', r.id, { enrolmentId: auth.enrolmentId });
            return { id: r.id, status: r.status, ...(supplied ? {} : { statusToken: token }), intakeKey: issued.key, created: true };
        }
        const data = { name: b.name, nameAr: b.nameAr, market, contactEmail: b.contactEmail ?? existing.contactEmail, readiness };
        if ((0, steps_1.needsHandshakeCreds)(b.kind) && secretsEnc) {
            if (existing.registrationId) {
                const reg = await this.prisma.partnerRegistration.findUnique({ where: { id: existing.registrationId } });
                const changed = !reg || reg.clientKey !== b.clientKey || reg.baseUrl !== baseUrl || (0, crypto_1.decryptField)(reg.clientSecretEnc) !== b.clientSecret || (0, crypto_1.decryptField)(reg.webhookSecretEnc) !== b.webhookSecret;
                if (changed)
                    data.pendingSecretsEnc = (0, crypto_1.encryptField)(JSON.stringify({ clientKey: b.clientKey, baseUrl, clientSecret: b.clientSecret, webhookSecret: b.webhookSecret }));
            }
            else {
                data.baseUrl = baseUrl;
                data.clientKey = b.clientKey;
                data.secretsEnc = secretsEnc;
            }
        }
        if (existing.status === 'CHANGES_REQUESTED')
            data.status = 'SUBMITTED';
        const reissued = auth.enrolmentId ? (0, contracts_1.generateIntakeKey)() : undefined;
        if (reissued)
            data.intakeKeyHash = reissued.signingKey;
        const r = await this.prisma.$transaction(async (tx) => { await this.consumeEnrolment(tx, auth, existing.id); return tx.partnerConnection.update({ where: { id: existing.id }, data }); });
        await this.audit('partner', data.pendingSecretsEnc ? 'rotation_submitted' : 'resubmitted', r.id, auth.enrolmentId ? { enrolmentId: auth.enrolmentId } : undefined);
        void this.runChecks('system', r.id).catch(() => undefined);
        return { id: r.id, status: r.status, created: false, ...(reissued ? { intakeKey: reissued.key } : {}) };
    }
    async authenticateIntake(b, raw, h, existing, ip) {
        const now = new Date();
        let key = DUMMY_KEY;
        let enrolmentId;
        let reason = 'NO_CREDENTIAL';
        const enrId = typeof h.enrolment === 'string' && /^kxe_[A-Za-z0-9_-]{8,16}$/.test(h.enrolment) ? h.enrolment : undefined;
        if (enrId) {
            const e = await this.prisma.partnerEnrolment.findUnique({ where: { id: enrId } });
            if (!e)
                reason = 'ENROLMENT_UNKNOWN';
            else if (e.status === 'REVOKED')
                reason = 'ENROLMENT_REVOKED';
            else if (e.status === 'USED')
                reason = 'ENROLMENT_USED';
            else if (e.expiresAt <= now)
                reason = 'ENROLMENT_EXPIRED';
            else if (e.kind !== b.kind || (e.orgRef && e.orgRef !== b.orgRef))
                reason = 'ENROLMENT_MISMATCH';
            else {
                key = e.signingKey;
                enrolmentId = e.id;
                reason = 'OK';
            }
        }
        else if (existing?.intakeKeyHash) {
            key = existing.intakeKeyHash;
            reason = 'OK';
        }
        else if (existing)
            reason = 'NEEDS_ENROLMENT';
        const sigOk = (0, contracts_1.verifyIntakeSignature)({ signingKey: key, body: raw, timestamp: h.timestamp, signature: h.signature });
        if (reason === 'OK' && !sigOk)
            reason = 'BAD_SIGNATURE';
        if (reason === 'OK') {
            const id = sha(`${b.kind}|${b.orgRef}|${b.nonce}`);
            try {
                await this.prisma.partnerIntakeNonce.create({ data: { id } });
            }
            catch {
                reason = 'REPLAY';
            }
            if (Math.random() < 0.02)
                void this.prisma.partnerIntakeNonce.deleteMany({ where: { seenAt: { lt: new Date(Date.now() - 3_600_000) } } }).catch(() => undefined);
        }
        if (reason !== 'OK') {
            await limiter.hit(`fail:${ip}`, 1_000_000, 600_000);
            const target = enrId ?? existing?.id;
            if (target && (await limiter.hit(`audit:${target}`, 10, 3_600_000)).ok)
                await this.audit('partner', 'intake_rejected', existing?.id ?? target, { reason, enrolmentId: enrId }).catch(() => undefined);
            throw UNAUTHORIZED();
        }
        return { enrolmentId };
    }
    async consumeEnrolment(tx, auth, connectionId) {
        if (!auth.enrolmentId)
            return;
        const n = await tx.partnerEnrolment.updateMany({ where: { id: auth.enrolmentId, status: 'ACTIVE', expiresAt: { gt: new Date() } }, data: { status: 'USED', usedAt: new Date(), connectionId } });
        if (n.count !== 1)
            throw UNAUTHORIZED();
    }
    async partnerStatus(id, token, ip = 'unknown') {
        const c = (0, config_1.cfg)();
        const a = await limiter.hit(`get:${ip}`, c.intakeStatusIpPerMin, 60_000);
        if (!a.ok)
            throw tooMany(a.retryAfterSec);
        const b = await limiter.hit(`get-id:${id.slice(0, 64)}`, 60, 60_000);
        if (!b.ok)
            throw tooMany(b.retryAfterSec);
        const r = await this.prisma.partnerConnection.findUnique({ where: { id } });
        if (!r || !token || !eq(r.statusTokenHash, sha(token)))
            throw (0, errors_1.notFound)('PARTNER_CONNECTION_NOT_FOUND', 'Connection request not found');
        const steps = (0, steps_1.computeSteps)(this.input(r));
        return { id: r.id, kind: r.kind, status: r.status, decisionReason: r.status === 'LIVE' ? null : r.decisionReason, progress: (0, steps_1.progressPct)(steps), steps: steps.map((s) => ({ key: s.key, type: s.type, state: s.state })), liveAt: r.liveAt, updatedAt: r.updatedAt };
    }
    conn(r, secret, kind) {
        return { baseUrl: `${(r.baseUrl ?? '').replace(/\/+$/, '')}${kind === 'PHARMACY' ? contracts_1.PARTNER_API_PATH.pharmacy : contracts_1.PARTNER_API_PATH.lab}`, clientKey: r.clientKey ?? '', clientSecret: secret, timeoutMs: (0, config_1.cfg)().partnerTimeoutMs };
    }
    async handshake(kind, c) {
        try {
            const res = await (0, partner_http_1.partnerRequest)(c, { method: 'GET', path: kind === 'PHARMACY' ? '/catalogue' : '/tests' });
            return { status: 'PASSED', code: 'SIGNED_PING_OK', items: Array.isArray(res.data?.items) ? res.data.items.length : 0 };
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerHttpError) {
                if (e.status === 403 && e.code === 'FEATURE_DISABLED')
                    return { status: 'WARN', code: 'SIGNED_PING_OK_FLAG_OFF', items: 0 };
                return { status: 'FAILED', code: e.status === 401 ? 'SIGNATURE_REJECTED' : `PARTNER_HTTP_${e.status}`, detail: { partnerCode: e.code ?? null } };
            }
            if (e instanceof partner_http_1.PartnerTransientError)
                return { status: 'FAILED', code: 'PARTNER_UNREACHABLE', detail: { kind: e.kind } };
            return { status: 'FAILED', code: 'PARTNER_ERROR' };
        }
    }
    async runChecks(actor, id) {
        const r = await this.row(id);
        const kind = r.kind;
        const items = {};
        const rd = (r.readiness ?? {});
        let secrets = {};
        if ((0, steps_1.needsHandshakeCreds)(kind)) {
            try {
                secrets = r.secretsEnc ? JSON.parse((0, crypto_1.decryptField)(r.secretsEnc)) : {};
            }
            catch {
                secrets = {};
            }
            const hasKey = !!(r.baseUrl && r.clientKey && (secrets.clientSecret || r.registrationId));
            items.credentials = hasKey ? { status: 'PASSED', code: 'CREDENTIALS_PRESENT' } : { status: 'FAILED', code: 'CREDENTIALS_MISSING' };
        }
        else
            items.credentials = { status: 'SKIPPED', code: 'SIGNED_INTAKE_VERIFIED' };
        if ((0, steps_1.needsHandshakeCreds)(kind)) {
            if (items.credentials.status !== 'PASSED') {
                items.handshake = { status: 'FAILED', code: 'NO_CREDENTIALS' };
                items.sync_dry_run = { status: 'FAILED', code: 'NO_HANDSHAKE' };
            }
            else {
                let secret = secrets.clientSecret;
                if (!secret && r.registrationId) {
                    const reg = await this.prisma.partnerRegistration.findUnique({ where: { id: r.registrationId } });
                    secret = reg ? (0, crypto_1.decryptField)(reg.clientSecretEnc) : undefined;
                }
                const h = await this.handshake(kind, this.conn(r, secret ?? '', kind));
                items.handshake = { status: h.status, code: h.code, detail: h.detail };
                const n = h.items ?? 0;
                items.sync_dry_run = h.status === 'FAILED' ? { status: 'FAILED', code: 'NO_HANDSHAKE' } : n > 0 ? { status: 'PASSED', code: 'CATALOGUE_READY', detail: { items: n } } : { status: h.status === 'WARN' ? 'WARN' : 'FAILED', code: h.status === 'WARN' ? 'FLAG_OFF_COUNT_UNKNOWN' : 'EMPTY_CATALOGUE', detail: { items: 0 } };
            }
        }
        else {
            try {
                const res = await this.kiorly.request({ method: 'GET', path: `/connection/${encodeURIComponent(r.orgRef)}` });
                const ok = res.data?.orgRef === r.orgRef;
                items.handshake = ok ? { status: 'PASSED', code: 'SIGNED_PING_OK' } : { status: 'FAILED', code: 'ORG_NOT_RECOGNISED' };
                const ready = res.data?.listings?.ready ?? 0;
                items.sync_dry_run = ok && ready > 0 ? { status: 'PASSED', code: 'LISTINGS_READY', detail: { total: res.data?.listings?.total ?? 0, ready } } : { status: 'FAILED', code: ok ? 'NO_READY_LISTINGS' : 'NO_HANDSHAKE', detail: { total: res.data?.listings?.total ?? 0, ready } };
            }
            catch (e) {
                const code = e instanceof kiorly_public_1.KiorlyHttpError ? (e.status === 404 ? 'ORG_NOT_RECOGNISED' : `CLINIC_HTTP_${e.status}`) : 'CLINIC_UNREACHABLE';
                items.handshake = { status: 'FAILED', code };
                items.sync_dry_run = { status: 'FAILED', code: 'NO_HANDSHAKE' };
            }
        }
        const gates = [];
        const states = {};
        let flagFail;
        for (const f of steps_1.KIND_FLAGS[kind]) {
            const e = await this.flags.evaluate(f.key, { market: r.market, orgId: r.orgRef });
            states[f.key] = e.effective ? 'ON' : e.reason;
            const def = await this.prisma.flagDefinition.findUnique({ where: { key: f.key } });
            if (def?.launchLocked)
                gates.push({ flag: f.key, gateIds: def.gateIds, satisfied: e.reason !== 'AWAITING_GATE' });
            if (!e.effective && e.reason !== 'AWAITING_GATE' && e.reason !== 'DEPENDENCY_OFF')
                flagFail = flagFail ?? `FLAG_${e.reason}`;
            if (!e.effective && e.reason === 'DEPENDENCY_OFF') {
                const dep = e.blockedBy ?? '';
                const depGate = dep && (await this.prisma.flagDefinition.findUnique({ where: { key: dep } }))?.launchLocked;
                if (!depGate)
                    flagFail = flagFail ?? 'FLAG_DEPENDENCY_OFF';
            }
        }
        items.flags = flagFail ? { status: 'FAILED', code: flagFail, detail: { states, gates } } : gates.some((g) => !g.satisfied) ? { status: 'WARN', code: 'AWAITING_GATE', detail: { states, gates } } : { status: 'PASSED', code: 'FLAGS_READY', detail: { states, gates } };
        items.market_pack = (await this.markets.isLive(r.market)) ? { status: 'PASSED', code: 'MARKET_LIVE', detail: { market: r.market } } : { status: 'FAILED', code: 'MARKET_NOT_LIVE', detail: { market: r.market } };
        const dup = [];
        if (kind === 'CLINIC' || kind === 'NURSE') {
            if ((await this.prisma.provider.count({ where: { tenantId: r.orgRef, status: 'LIVE' } })) > 0 && r.status !== 'LIVE')
                dup.push('ALREADY_LISTED');
        }
        else {
            const regs = await this.prisma.partnerRegistration.findMany({ where: { kind, clientKey: r.clientKey ?? '__none__' } });
            if (regs.some((g) => g.id !== r.registrationId))
                dup.push('REGISTRY_DUPLICATE');
        }
        const same = await this.prisma.partnerConnection.findMany({ where: { id: { not: r.id }, kind: r.kind, market: r.market, name: { equals: r.name, mode: 'insensitive' } }, select: { id: true } });
        if ((0, steps_1.needsHandshakeCreds)(kind) && (await this.prisma.partnerRegistration.count({ where: { kind, name: { equals: r.name, mode: 'insensitive' }, ...(r.registrationId ? { id: { not: r.registrationId } } : {}) } })) > 0)
            same.push({ id: 'registry' });
        items.duplicates = dup.length ? { status: 'FAILED', code: dup[0], detail: { all: dup } } : same.length ? { status: 'WARN', code: 'SIMILAR_NAME', detail: { count: same.length } } : { status: 'PASSED', code: 'NO_DUPLICATES' };
        const docs = (rd.documents ?? {});
        const missing = [];
        const need = kind === 'CLINIC' || kind === 'NURSE' ? ['doctorCredentials'] : ['licence'];
        for (const d of need)
            if (!docs[d])
                missing.push(d);
        if (!rd.termsAcceptedAt)
            missing.push('terms');
        items.documents = missing.length ? { status: 'FAILED', code: 'DOCUMENTS_MISSING', detail: { missing } } : { status: 'PASSED', code: 'DOCUMENTS_PRESENT' };
        const doc = { ranAt: new Date().toISOString(), items };
        await this.prisma.partnerConnection.update({ where: { id }, data: { checks: doc, checksRunAt: new Date() } });
        const moved = (await this.prisma.partnerConnection.updateMany({ where: { id, status: 'SUBMITTED' }, data: { status: 'IN_REVIEW' } })).count > 0;
        const upd = await this.row(id);
        await this.audit(actor, 'checks_run', id, { failed: Object.entries(items).filter(([, v]) => v.status === 'FAILED').map(([k]) => k) });
        if (moved)
            void this.pushToClinic(upd, 'IN_REVIEW').catch(() => undefined);
        return this.view(upd);
    }
    async mutateHuman(actor, id, step, patch) {
        const r = await this.row(id);
        if (['LIVE', 'REJECTED'].includes(r.status))
            throw (0, errors_1.conflict)('CONNECTION_LOCKED', 'This connection can no longer change', { status: r.status });
        const human = { ...(r.human ?? {}), ...patch };
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { human: human, ...(r.status === 'AWAITING_APPROVAL' ? { status: 'IN_REVIEW', requestedBy: null } : {}) } });
        await this.audit(actor, `step_${step}`, id);
        return this.view(u);
    }
    async reviewDocuments(actor, id, note) {
        const r = await this.row(id);
        if (r.checks?.items?.documents?.status !== 'PASSED')
            throw (0, errors_1.conflict)('DOCUMENTS_CHECK_REQUIRED', 'Documents must be present (automated check) before a human reviews them');
        return this.mutateHuman(actor, id, 'review_documents', { documents: { by: actor, at: new Date().toISOString(), note: note?.slice(0, 200) } });
    }
    async verifyLicence(actor, id, reference) {
        if (!reference || reference.trim().length < 3)
            throw (0, errors_1.badRequest)('LICENCE_REFERENCE_REQUIRED', 'Enter the licence / registration reference you verified');
        return this.mutateHuman(actor, id, 'verify_licence', { licence: { by: actor, at: new Date().toISOString(), reference: reference.trim().slice(0, 80) } });
    }
    async confirmFees(actor, id, mode, note) {
        if (mode !== 'STANDARD' && mode !== 'ORG_OVERRIDE')
            throw (0, errors_1.badRequest)('INVALID_FEE_MODE', 'mode must be STANDARD or ORG_OVERRIDE');
        if (mode === 'ORG_OVERRIDE' && !note?.trim())
            throw (0, errors_1.badRequest)('FEE_NOTE_REQUIRED', 'Say which organisation-scope policy override was set (Policy page) and why');
        return this.mutateHuman(actor, id, 'fees', { fees: { by: actor, at: new Date().toISOString(), mode, note: note?.slice(0, 200) } });
    }
    async requestChanges(actor, id, reason) {
        if (!reason?.trim())
            throw (0, errors_1.badRequest)('REASON_REQUIRED', 'A reason is required');
        const r = await this.row(id);
        if (['LIVE', 'REJECTED'].includes(r.status))
            throw (0, errors_1.conflict)('CONNECTION_LOCKED', 'This connection can no longer change');
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'CHANGES_REQUESTED', decisionReason: reason.trim().slice(0, 300), requestedBy: null } });
        await this.audit(actor, 'changes_requested', id);
        void this.notify(u, 'CHANGES_REQUESTED');
        void this.pushToClinic(u, 'CHANGES_REQUESTED').catch(() => undefined);
        return this.view(u);
    }
    async reject(actor, id, reason) {
        if (!reason?.trim())
            throw (0, errors_1.badRequest)('REASON_REQUIRED', 'A reason is required');
        const r = await this.row(id);
        if (r.status === 'LIVE')
            throw (0, errors_1.conflict)('CONNECTION_LOCKED', 'Pause a live connection instead of rejecting it');
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'REJECTED', decisionReason: reason.trim().slice(0, 300), secretsEnc: null } });
        await this.audit(actor, 'rejected', id);
        void this.notify(u, 'REJECTED');
        void this.pushToClinic(u, 'REJECTED').catch(() => undefined);
        return this.view(u);
    }
    async requestApproval(actor, id) {
        const r = await this.row(id);
        if (!['IN_REVIEW', 'SUBMITTED'].includes(r.status))
            throw (0, errors_1.conflict)('INVALID_STATE', 'Only a connection in review can be sent for approval', { status: r.status });
        const input = this.input(r);
        const open = (0, steps_1.computeSteps)(input).filter((s) => !['approval', 'go_live'].includes(s.key) && s.state !== 'DONE' && s.state !== 'WARN').map((s) => s.key);
        if (open.length)
            throw (0, errors_1.conflict)('STEPS_OPEN', 'Finish every automated check and human step first', { open });
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'AWAITING_APPROVAL', requestedBy: actor } });
        await this.audit(actor, 'approval_requested', id);
        return this.view(u);
    }
    async approve(actor, id) {
        const r = await this.row(id);
        if (r.status !== 'AWAITING_APPROVAL')
            throw (0, errors_1.conflict)('INVALID_STATE', 'Nothing awaits approval', { status: r.status });
        const licBy = (r.human ?? {}).licence?.by;
        if (r.requestedBy === actor || licBy === actor)
            throw (0, errors_1.forbidden)('TWO_PERSON_RULE', 'Approval needs a different person than the requester and the licence verifier');
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'APPROVED', approvedBy: actor, approvedAt: new Date(), decisionReason: null } });
        await this.audit(actor, 'approved', id);
        return this.view(u);
    }
    async goLive(actor, id) {
        const r = await this.row(id);
        if (r.status === 'LIVE')
            return this.view(r);
        const blockers = (0, steps_1.goLiveBlockers)(this.input(r));
        if (blockers.length)
            throw (0, errors_1.conflict)('GO_LIVE_BLOCKED', 'Every automated check and human step must be green', { blockers });
        const kind = r.kind;
        if ((0, steps_1.needsHandshakeCreds)(kind)) {
            let regId = r.registrationId;
            if (!regId) {
                const s = JSON.parse((0, crypto_1.decryptField)(r.secretsEnc));
                const reg = await this.registry.upsert(kind.toLowerCase(), undefined, { name: r.name, baseUrl: r.baseUrl, clientKey: r.clientKey, clientSecret: s.clientSecret, webhookSecret: s.webhookSecret, active: true });
                regId = reg.id;
            }
            else
                await this.registry.upsert(kind.toLowerCase(), regId, { active: true });
            await this.prisma.partnerConnection.update({ where: { id }, data: { registrationId: regId, secretsEnc: null } });
        }
        for (const f of steps_1.KIND_FLAGS[kind].filter((x) => !x.launchLocked)) {
            const def = await this.prisma.flagDefinition.findUnique({ where: { key: f.key } });
            if (def?.scopes.includes('ORG'))
                await this.flags.setValue(actor, { key: f.key, scope: 'ORG', scopeId: r.orgRef, value: 'ON', reason: 'Partner connection go-live', ticket: id });
        }
        if (!(0, steps_1.needsHandshakeCreds)(kind)) {
            try {
                await this.kiorly.request({ method: 'PUT', path: `/connection/${encodeURIComponent(r.orgRef)}`, body: { decision: 'APPROVED', connectionId: id } });
            }
            catch (e) {
                throw new errors_1.ApiError(503, 'CLINIC_NOTIFY_FAILED', 'Kiorly could not be told about the approval; nothing changed, retry Go live', { cause: e instanceof kiorly_public_1.KiorlyHttpError ? `HTTP_${e.status}` : 'UNREACHABLE' });
            }
            void this.catalog.syncOnce().catch(() => undefined);
        }
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'LIVE', liveAt: new Date(), decisionReason: null } });
        await this.audit(actor, 'went_live', id);
        void this.notify(u, 'LIVE');
        return this.view(u);
    }
    async pause(actor, id, reason) {
        if (!reason?.trim())
            throw (0, errors_1.badRequest)('REASON_REQUIRED', 'A reason is required');
        const r = await this.row(id);
        if (r.status !== 'LIVE')
            throw (0, errors_1.conflict)('INVALID_STATE', 'Only a live connection can be paused');
        if (r.registrationId)
            await this.registry.upsert(r.kind.toLowerCase(), r.registrationId, { active: false });
        if (r.kind === 'CLINIC' || r.kind === 'NURSE')
            await this.pushToClinic(r, 'PAUSED', reason).catch(() => undefined);
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'PAUSED', decisionReason: reason.trim().slice(0, 300) } });
        await this.audit(actor, 'paused', id);
        void this.notify(u, 'PAUSED');
        return this.view(u);
    }
    async resume(actor, id) {
        const r = await this.row(id);
        if (r.status !== 'PAUSED')
            throw (0, errors_1.conflict)('INVALID_STATE', 'Only a paused connection can resume');
        if (r.registrationId)
            await this.registry.upsert(r.kind.toLowerCase(), r.registrationId, { active: true });
        if (r.kind === 'CLINIC' || r.kind === 'NURSE')
            await this.pushToClinic(r, 'APPROVED').catch(() => undefined);
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { status: 'LIVE', decisionReason: null } });
        await this.audit(actor, 'resumed', id);
        void this.notify(u, 'LIVE');
        return this.view(u);
    }
    async applyRotation(actor, id) {
        const r = await this.row(id);
        if (!r.pendingSecretsEnc || !r.registrationId)
            throw (0, errors_1.conflict)('NO_ROTATION_PENDING', 'No credential rotation is waiting');
        const p = JSON.parse((0, crypto_1.decryptField)(r.pendingSecretsEnc));
        const h = await this.handshake(r.kind, this.conn({ baseUrl: p.baseUrl, clientKey: p.clientKey }, p.clientSecret, r.kind));
        if (h.status === 'FAILED')
            throw (0, errors_1.conflict)('ROTATION_HANDSHAKE_FAILED', 'The new credentials did not pass the signed handshake; the current ones stay active', { code: h.code });
        await this.registry.upsert(r.kind.toLowerCase(), r.registrationId, { baseUrl: p.baseUrl, clientKey: p.clientKey, clientSecret: p.clientSecret, webhookSecret: p.webhookSecret });
        const u = await this.prisma.partnerConnection.update({ where: { id }, data: { pendingSecretsEnc: null, clientKey: p.clientKey, baseUrl: p.baseUrl } });
        await this.audit(actor, 'rotation_applied', id);
        return this.view(u);
    }
    async list(q = {}) {
        const rows = await this.prisma.partnerConnection.findMany({ where: { ...(q.status ? { status: q.status } : {}), ...(q.kind ? { kind: q.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
        return rows.map((r) => { const v = this.view(r); return { id: v.id, kind: v.kind, name: v.name, nameAr: v.nameAr, market: v.market, status: v.status, progress: v.progress, humanActions: v.humanActions, createdAt: v.createdAt, updatedAt: v.updatedAt }; });
    }
    async get(id) { return this.view(await this.row(id)); }
    async auditTrail(id) { await this.row(id); return (await this.prisma.auditLog.findMany({ where: { resource: 'PartnerConnection', resourceId: id }, orderBy: { createdAt: 'asc' }, take: 200 })).map((a) => ({ id: a.id, actor: a.actor, action: a.action.replace('partner_onboarding.', ''), createdAt: a.createdAt, metadata: a.metadata })); }
    async notify(r, event) {
        if (!r.contactEmail)
            return;
        const locale = r.readiness?.locale === 'ar' ? 'ar' : 'en';
        try {
            await this.hub.send({ channel: 'EMAIL', to: r.contactEmail, templateId: `partner.onboarding.${event.toLowerCase()}`, locale, subject: locale === 'ar' ? 'الربط بكيوريكس' : 'Connect to Kiorex', body: MSG[event][locale], data: { connectionId: r.id } });
        }
        catch {
            this.log.warn(`notify failed id=${r.id} event=${event}`);
        }
    }
    async pushToClinic(r, decision, reason) {
        if (r.kind !== 'CLINIC' && r.kind !== 'NURSE')
            return;
        await this.kiorly.request({ method: 'PUT', path: `/connection/${encodeURIComponent(r.orgRef)}`, body: { decision, connectionId: r.id, ...(reason ? { reasonCode: 'OPS_NOTE' } : {}) } });
    }
};
exports.PartnerOnboardingService = PartnerOnboardingService;
exports.PartnerOnboardingService = PartnerOnboardingService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, control_plane_public_1.FlagsService, partners_public_1.PartnerRegistry, kiorly_public_1.KiorlyClient,
        catalog_public_1.CatalogService, messaging_public_1.MessagingHub, market_public_1.MarketService])
], PartnerOnboardingService);
//# sourceMappingURL=partner-onboarding.service.js.map