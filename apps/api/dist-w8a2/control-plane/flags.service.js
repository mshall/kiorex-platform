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
var FlagsService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.FlagsService = exports.DEV_GATE_PREFIX = void 0;
const common_1 = require("@nestjs/common");
const contracts_1 = require("@kiorex/contracts");
const config_1 = require("../common/config");
const outbound_http_1 = require("../common/outbound-http");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const outbox_public_1 = require("../outbox/outbox-public");
const prisma_service_1 = require("../prisma/prisma.service");
const flag_catalogue_1 = require("./flag-catalogue");
const flag_evaluator_1 = require("./flag-evaluator");
const safety_controls_1 = require("./safety-controls");
exports.DEV_GATE_PREFIX = 'DEV-ONLY-NOT-A-REAL-GATE:';
const baseGateId = (id) => (id.startsWith(exports.DEV_GATE_PREFIX) ? id.slice(exports.DEV_GATE_PREFIX.length) : id);
const DEV_PRODUCT_SECRET = 'ff_dev_secret_change_me';
const EMERGENCY_REVIEW_MS = 24 * 3600_000;
let FlagsService = FlagsService_1 = class FlagsService {
    prisma;
    outbox;
    log = new common_1.Logger('flags');
    cache;
    timer;
    constructor(prisma, outbox) {
        this.prisma = prisma;
        this.outbox = outbox;
    }
    onModuleInit() {
        this.outbox.register('flag.changed', (e) => this.deliverPush(e));
        if ((0, config_1.cfg)().jobsEnabled) {
            this.timer = setInterval(() => void this.sweep().catch((e) => this.log.error(e)), 30_000);
            this.timer.unref();
        }
    }
    onModuleDestroy() {
        if (this.timer)
            clearInterval(this.timer);
    }
    invalidate() {
        this.cache = undefined;
    }
    async load() {
        if (this.cache && Date.now() - this.cache.at < 1000)
            return this.cache;
        const [defs, values, gates, state] = await Promise.all([
            this.prisma.flagDefinition.findMany(),
            this.prisma.flagValue.findMany({ where: { value: 'OFF' } }),
            this.prisma.flagGateEvidence.findMany(),
            this.prisma.controlState.findUnique({ where: { id: 1 } }),
        ]);
        const now = new Date();
        const gatesByFlag = new Map();
        for (const g of gates)
            gatesByFlag.set(g.flagKey, (gatesByFlag.get(g.flagKey) ?? new Set()).add(baseGateId(g.gateId)));
        const map = new Map();
        for (const d of defs) {
            const f = { key: d.key, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: d.launchLocked, gateSatisfied: !d.launchLocked || FlagsService_1.gatesSatisfied(d.gateIds, gatesByFlag.get(d.key)), values: { markets: {}, orgs: {} } };
            map.set(d.key, f);
        }
        let earliest = new Map();
        for (const v of values) {
            if (!this.isActive(v, now))
                continue;
            const f = map.get(v.flagKey);
            if (!f)
                continue;
            if (v.scope === 'GLOBAL')
                f.values.global = 'OFF';
            else if (v.scope === 'MARKET')
                f.values.markets[v.scopeId.toUpperCase()] = 'OFF';
            else
                f.values.orgs[v.scopeId] = 'OFF';
            if (v.expiresAt && (!earliest.get(v.flagKey) || v.expiresAt < earliest.get(v.flagKey)))
                earliest.set(v.flagKey, v.expiresAt);
        }
        for (const [k, d] of earliest)
            map.get(k).expiresAt = d.toISOString();
        this.cache = { at: Date.now(), version: state?.version ?? 1, map, defs: new Map(defs.map((d) => [d.key, d])) };
        return this.cache;
    }
    static gatesSatisfied(required, have) {
        if (!have?.size)
            return false;
        return !required?.length || required.every((g) => have.has(g));
    }
    isActive(v, now) {
        return v.value === 'OFF' && (!v.startsAt || v.startsAt <= now) && (!v.expiresAt || v.expiresAt > now);
    }
    async evaluate(key, ctx = {}) {
        return (0, flag_evaluator_1.evaluateFlag)((await this.load()).map, key, ctx);
    }
    async isEnabled(key, ctx = {}) {
        return (await this.evaluate(key, ctx)).effective;
    }
    async assertEnabled(key, ctx = {}) {
        const r = await this.evaluate(key, ctx);
        if (!r.effective)
            throw (0, errors_1.forbidden)('FEATURE_DISABLED', 'Feature temporarily unavailable', { key, scope: r.scope ?? 'GLOBAL', reason: r.reason, ...(r.blockedBy ? { blockedBy: r.blockedBy } : {}) });
    }
    async currentVersion() {
        return (await this.load()).version;
    }
    async registerDefinition(actor, d) {
        if ((0, safety_controls_1.isSafetyControlKey)(d.key))
            throw (0, errors_1.badRequest)('SAFETY_CONTROL_NOT_A_FLAG', `ADR-025: "${d.key}" is a safety control and can never be a feature flag`);
        if (!/^[a-z0-9_.]+$/.test(d.key))
            throw (0, errors_1.badRequest)('INVALID_FLAG_KEY', 'Flag keys are lowercase [a-z0-9_.]');
        if (d.class === 'LAUNCH_LOCKED' && !d.launchLocked)
            d = { ...d, launchLocked: true };
        const row = await this.prisma.flagDefinition.upsert({
            where: { key: d.key },
            create: { key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, description: d.description, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
            update: { product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, description: d.description, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
        });
        await this.bump([d.key], actor, 'definition');
        return row;
    }
    async seed(opts = { devKeys: true }) {
        for (const d of flag_catalogue_1.FLAG_CATALOGUE) {
            if ((0, safety_controls_1.isSafetyControlKey)(d.key))
                throw new Error(`catalogue contains safety control ${d.key}`);
            await this.prisma.flagDefinition.upsert({
                where: { key: d.key },
                create: { key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, description: d.description, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
                update: { product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, launchLocked: !!d.launchLocked, moneyPath: !!d.moneyPath, whenOff: d.whenOff, gateHint: d.gateHint, gateIds: d.gateIds ?? [], edition: d.edition },
            });
        }
        await this.prisma.controlState.upsert({ where: { id: 1 }, create: { id: 1, version: 1 }, update: {} });
        if (opts.devKeys !== false) {
            for (const p of flag_catalogue_1.PRODUCTS) {
                await this.prisma.productRegistration.upsert({
                    where: { product: p },
                    create: {
                        product: p, keyId: `ff_${p}_dev`, secretEnc: (0, crypto_1.encryptField)(DEV_PRODUCT_SECRET),
                        webhookUrl: p === 'kiorly-clinic' ? 'http://localhost:3010/api/v1/feature-flags/kiorex/changed' : null,
                        webhookSecretEnc: (0, crypto_1.encryptField)(DEV_PRODUCT_SECRET),
                    },
                    update: {},
                });
            }
        }
        this.invalidate();
    }
    async def(key) {
        const d = (await this.load()).defs.get(key) ?? (await this.prisma.flagDefinition.findUnique({ where: { key } }));
        if (!d)
            throw (0, errors_1.notFound)('FLAG_NOT_FOUND', `Unknown flag ${key}`);
        return d;
    }
    async setValue(actor, i) {
        const d = await this.def(i.key);
        const scopeId = i.scope === 'GLOBAL' ? '' : (i.scopeId ?? '').trim();
        if (!d.scopes.includes(i.scope))
            throw (0, errors_1.badRequest)('SCOPE_NOT_ALLOWED', `${i.key} cannot be set at ${i.scope} scope`, { allowed: d.scopes });
        if (i.scope !== 'GLOBAL' && !scopeId)
            throw (0, errors_1.badRequest)('SCOPE_ID_REQUIRED', 'scopeId required for market/org scope');
        if (!i.reason?.trim() || !i.ticket?.trim())
            throw (0, errors_1.badRequest)('REASON_AND_TICKET_REQUIRED', 'reason and ticket are required (KXM-OP-08)');
        if (i.expiresAt && i.expiresAt <= new Date())
            throw (0, errors_1.badRequest)('EXPIRY_IN_PAST', 'expiresAt must be in the future');
        const sid = i.scope === 'MARKET' ? scopeId.toUpperCase() : scopeId;
        const twoPerson = i.value === 'OFF' && d.moneyPath && (i.scope === 'GLOBAL' || i.scope === 'MARKET');
        if (twoPerson && !i.emergency) {
            const req = await this.prisma.flagChangeRequest.create({ data: { flagKey: i.key, scope: i.scope, scopeId: sid, value: 'OFF', reason: i.reason, ticket: i.ticket, expiresAt: i.expiresAt ?? null, requestedBy: actor } });
            await this.auditRow({ flagKey: i.key, scope: i.scope, scopeId: sid, newValue: 'OFF', actor, reason: i.reason, ticket: i.ticket, event: 'REQUEST' });
            return { status: 'PENDING_APPROVAL', requestId: req.id };
        }
        const version = await this.apply(actor, d, i.scope, sid, i.value, i, !!(twoPerson && i.emergency));
        if (twoPerson && i.emergency) {
            await this.prisma.flagChangeRequest.create({ data: { flagKey: i.key, scope: i.scope, scopeId: sid, value: 'OFF', reason: i.reason, ticket: i.ticket, expiresAt: i.expiresAt ?? null, requestedBy: actor, status: 'APPROVED', approvedBy: actor, emergency: true, reviewDueAt: new Date(Date.now() + EMERGENCY_REVIEW_MS), decidedAt: new Date() } });
        }
        return { status: 'APPLIED', version };
    }
    async apply(actor, d, scope, scopeId, value, i, emergency = false) {
        const prev = await this.prisma.flagValue.findUnique({ where: { flagKey_scope_scopeId: { flagKey: d.key, scope, scopeId } } });
        await this.prisma.flagValue.upsert({
            where: { flagKey_scope_scopeId: { flagKey: d.key, scope, scopeId } },
            create: { flagKey: d.key, scope, scopeId, value, reason: i.reason, ticket: i.ticket, setBy: actor, expiresAt: i.expiresAt ?? null, startsAt: i.startsAt ?? null },
            update: { value, reason: i.reason, ticket: i.ticket, setBy: actor, expiresAt: i.expiresAt ?? null, startsAt: i.startsAt ?? null },
        });
        await this.auditRow({ flagKey: d.key, scope, scopeId, oldValue: prev?.value ?? 'ON', newValue: value, actor, reason: i.reason, ticket: i.ticket, expiresAt: i.expiresAt ?? undefined, emergency, event: 'TOGGLE' });
        return this.bump([d.key], actor, `${d.key}:${scope}:${value}`);
    }
    async approveRequest(approver, id) {
        const r = await this.prisma.flagChangeRequest.findUnique({ where: { id } });
        if (!r)
            throw (0, errors_1.notFound)('REQUEST_NOT_FOUND', 'Change request not found');
        if (r.status !== 'PENDING')
            throw (0, errors_1.conflict)('REQUEST_NOT_PENDING', `Request is ${r.status}`);
        if (r.requestedBy === approver)
            throw (0, errors_1.forbidden)('SECOND_APPROVER_REQUIRED', 'Two-person rule: a different admin must approve (KXM-OP-10)');
        const d = await this.def(r.flagKey);
        const version = await this.apply(approver, d, r.scope, r.scopeId, 'OFF', { reason: r.reason, ticket: r.ticket, expiresAt: r.expiresAt });
        await this.prisma.flagChangeRequest.update({ where: { id }, data: { status: 'APPROVED', approvedBy: approver, decidedAt: new Date() } });
        await this.auditRow({ flagKey: r.flagKey, scope: r.scope, scopeId: r.scopeId, newValue: 'OFF', actor: approver, reason: r.reason, ticket: r.ticket, event: 'APPROVE' });
        return { status: 'APPROVED', version };
    }
    async rejectRequest(actor, id) {
        const r = await this.prisma.flagChangeRequest.findUnique({ where: { id } });
        if (!r || r.status !== 'PENDING')
            throw (0, errors_1.notFound)('REQUEST_NOT_FOUND', 'No pending request');
        await this.prisma.flagChangeRequest.update({ where: { id }, data: { status: 'REJECTED', approvedBy: actor, decidedAt: new Date() } });
        return { status: 'REJECTED' };
    }
    async reviewEmergency(reviewer, id) {
        const r = await this.prisma.flagChangeRequest.findUnique({ where: { id } });
        if (!r?.emergency)
            throw (0, errors_1.notFound)('REQUEST_NOT_FOUND', 'Not an emergency change');
        await this.prisma.flagChangeRequest.update({ where: { id }, data: { reviewedBy: reviewer, reviewedAt: new Date() } });
        await this.auditRow({ flagKey: r.flagKey, scope: r.scope, scopeId: r.scopeId, newValue: 'OFF', actor: reviewer, reason: 'emergency review', event: 'REVIEW', emergency: true });
        return { status: 'REVIEWED' };
    }
    listRequests(status) {
        return this.prisma.flagChangeRequest.findMany({ where: status ? { status } : {}, orderBy: { createdAt: 'desc' }, take: 200 });
    }
    async overdueEmergencyReviews() {
        return this.prisma.flagChangeRequest.findMany({ where: { emergency: true, reviewedAt: null, reviewDueAt: { lt: new Date() } } });
    }
    async recordGate(actor, key, g) {
        const d = await this.def(key);
        if (!d.launchLocked)
            throw (0, errors_1.badRequest)('NOT_LAUNCH_LOCKED', `${key} is not launch-locked`);
        if (!g.gateId?.trim() || !g.approver?.trim() || !g.documentUrl?.trim() || !g.approvedOn)
            throw (0, errors_1.badRequest)('GATE_EVIDENCE_INCOMPLETE', 'gateId, approver, approvedOn and documentUrl are required (KXM-OP-09)');
        if (!/^https?:\/\//i.test(g.documentUrl))
            throw (0, errors_1.badRequest)('GATE_DOCUMENT_URL_INVALID', 'documentUrl must be an http(s) link');
        const gateId = g.gateId.trim();
        if (gateId.startsWith(exports.DEV_GATE_PREFIX) && (0, config_1.cfg)().isProd)
            throw (0, errors_1.badRequest)('DEV_GATE_IN_PRODUCTION', 'DEV-ONLY gate evidence is never accepted in production');
        if (d.gateIds.length && !d.gateIds.includes(baseGateId(gateId)))
            throw (0, errors_1.badRequest)('GATE_ID_NOT_REQUIRED', `${key} is unlocked by gate(s) ${d.gateIds.join(' + ')}, not ${gateId}`, { required: d.gateIds });
        await this.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId } }, create: { flagKey: key, ...g, gateId, recordedBy: actor }, update: { ...g, gateId, recordedBy: actor } });
        await this.auditRow({ flagKey: key, scope: 'GLOBAL', newValue: 'GATE_SATISFIED', oldValue: 'AWAITING_GATE', actor, reason: `${gateId} approved by ${g.approver}`, event: 'GATE' });
        return { version: await this.bump([key], actor, `${key}:gate`) };
    }
    async recordGateForAll(actor, gateId, g) {
        const defs = await this.prisma.flagDefinition.findMany({ where: { launchLocked: true, gateIds: { has: baseGateId(gateId) } } });
        if (!defs.length)
            throw (0, errors_1.notFound)('GATE_NOT_FOUND', `No launch-locked flag lists gate ${gateId}`);
        let version = 0;
        for (const d of defs)
            version = (await this.recordGate(actor, d.key, { ...g, gateId })).version;
        return { gateId, flags: defs.map((d) => d.key), version };
    }
    async revokeGate(actor, key, reason, gateId) {
        await this.def(key);
        await this.prisma.flagGateEvidence.deleteMany({ where: { flagKey: key, ...(gateId ? { OR: [{ gateId }, { gateId: `${exports.DEV_GATE_PREFIX}${gateId}` }] } : {}) } });
        await this.auditRow({ flagKey: key, scope: 'GLOBAL', newValue: 'AWAITING_GATE', oldValue: 'GATE_SATISFIED', actor, reason: gateId ? `${gateId}: ${reason}` : reason, event: 'GATE' });
        return { version: await this.bump([key], actor, `${key}:gate-revoked`) };
    }
    async gateBoard() {
        const [defs, gates] = await Promise.all([this.prisma.flagDefinition.findMany({ where: { launchLocked: true }, orderBy: { key: 'asc' } }), this.prisma.flagGateEvidence.findMany()]);
        const ids = [...new Set(defs.flatMap((d) => d.gateIds))].sort();
        return {
            gates: ids.map((gateId) => ({
                gateId,
                flags: defs.filter((d) => d.gateIds.includes(gateId)).map((d) => {
                    const ev = gates.find((x) => x.flagKey === d.key && baseGateId(x.gateId) === gateId);
                    return { key: d.key, requiredGates: d.gateIds, evidence: ev ? { approver: ev.approver, approvedOn: ev.approvedOn, documentUrl: ev.documentUrl, recordedBy: ev.recordedBy } : null };
                }),
            })),
        };
    }
    async auditRow(a) {
        await this.prisma.flagAudit.create({ data: { flagKey: a.flagKey, scope: a.scope, scopeId: a.scopeId ?? '', oldValue: a.oldValue, newValue: a.newValue, actor: a.actor, reason: a.reason, ticket: a.ticket, expiresAt: a.expiresAt, emergency: !!a.emergency, event: a.event } });
    }
    async bump(keys, actor, why) {
        const st = await this.prisma.controlState.upsert({ where: { id: 1 }, create: { id: 1, version: 2 }, update: { version: { increment: 1 }, updatedAt: new Date() } });
        this.invalidate();
        const regs = await this.prisma.productRegistration.findMany({ where: { active: true, webhookUrl: { not: null } } });
        for (const r of regs) {
            await this.outbox.enqueue(this.prisma, { type: 'flag.changed', aggregateType: 'Product', aggregateId: r.product, target: `PRODUCT:${r.product}`, payload: { product: r.product, version: st.version, keys, why, actor }, dedupeKey: `flag.changed:${r.product}:${st.version}` });
        }
        return st.version;
    }
    async sweep() {
        const now = new Date();
        const expired = await this.prisma.flagValue.findMany({ where: { value: 'OFF', expiresAt: { lte: now } } });
        for (const v of expired) {
            await this.prisma.flagValue.update({ where: { id: v.id }, data: { value: 'ON', reason: `expired (was: ${v.reason ?? ''})` } });
            await this.auditRow({ flagKey: v.flagKey, scope: v.scope, scopeId: v.scopeId, oldValue: 'OFF', newValue: 'ON', actor: 'system', reason: 'expiry', event: 'EXPIRY' });
        }
        const sig = await this.prisma.kvState.findUnique({ where: { key: 'flags.sched' } });
        const started = await this.prisma.flagValue.findMany({ where: { value: 'OFF', startsAt: { lte: now, gt: new Date(sig?.value?.at ?? 0) } } });
        await this.prisma.kvState.upsert({ where: { key: 'flags.sched' }, create: { key: 'flags.sched', value: { at: now.getTime() } }, update: { value: { at: now.getTime() } } });
        const keys = [...expired, ...started].map((v) => v.flagKey);
        if (keys.length)
            await this.bump(keys, 'system', 'sweep');
        return { expired: expired.length, started: started.length };
    }
    async productSecret(keyId) {
        const r = await this.prisma.productRegistration.findUnique({ where: { keyId } });
        if (!r || !r.active)
            return null;
        return { product: r.product, secret: (0, crypto_1.decryptField)(r.secretEnc) };
    }
    async snapshot(product, opts = {}) {
        const c = await this.load();
        const reg = await this.prisma.productRegistration.findUnique({ where: { product } });
        if (!reg)
            throw (0, errors_1.notFound)('UNKNOWN_PRODUCT', `Unknown product ${product}`);
        const own = [...c.defs.values()].filter((d) => d.product === product || d.product === 'all' || (product === 'kiorly-clinic' && d.product === 'kiorly-nurse')).map((d) => d.key);
        const include = new Set();
        const visit = (k) => {
            if (include.has(k) || !c.map.has(k))
                return;
            include.add(k);
            c.map.get(k).dependsOn.forEach(visit);
        };
        own.forEach(visit);
        const state = await this.prisma.controlState.findUnique({ where: { id: 1 } });
        const flags = [...include].sort().map((k) => {
            const f = c.map.get(k);
            return { key: f.key, class: f.class, scopes: f.scopes, dependsOn: f.dependsOn, launchLocked: f.launchLocked, gateSatisfied: f.gateSatisfied, values: f.values, ...(f.expiresAt ? { expiresAt: f.expiresAt } : {}) };
        });
        const generatedAt = (state?.updatedAt ?? new Date()).toISOString();
        const unsigned = { product, version: c.version, generatedAt, flags };
        const secret = (0, crypto_1.decryptField)(reg.secretEnc);
        const signature = (0, contracts_1.signSnapshot)(secret, unsigned);
        if (opts.touch)
            await this.prisma.productRegistration.update({ where: { product }, data: { lastFetchedVersion: c.version, lastFetchedAt: new Date() } });
        return { body: { ...unsigned, signature }, etag: `"v${c.version}:${product}"`, version: c.version };
    }
    async deliverPush(e) {
        const reg = await this.prisma.productRegistration.findUnique({ where: { product: e.aggregateId } });
        if (!reg?.webhookUrl)
            return;
        const secret = (0, crypto_1.decryptField)(reg.webhookSecretEnc ?? reg.secretEnc);
        const keys = e.payload.keys ?? [];
        const eventId = `flag.changed:${reg.product}:${e.payload.version}`;
        const body = JSON.stringify({
            eventId, type: 'flag.changed', aggregateType: 'Flag', aggregateId: keys[0] ?? reg.product, target: reg.product, occurredAt: new Date().toISOString(),
            data: { product: reg.product, key: keys[0] ?? '*', keys, snapshotVersion: e.payload.version, changedAt: new Date().toISOString(), reason: e.payload.why, actor: e.payload.actor },
        });
        const signed = (0, contracts_1.signWebhook)({ secret, body, eventType: 'flag.changed', eventId });
        try {
            const res = await (0, outbound_http_1.outboundFetch)(reg.webhookUrl, {
                method: 'POST',
                headers: { ...signed.headers },
                body,
                signal: AbortSignal.timeout(10_000),
            });
            if (!res.ok)
                throw new Error(`HTTP ${res.status}`);
            await this.prisma.productRegistration.update({ where: { product: reg.product }, data: { lastPushedVersion: e.payload.version, lastPushedAt: new Date(), lastPushError: null } });
        }
        catch (err) {
            await this.prisma.productRegistration.update({ where: { product: reg.product }, data: { lastPushError: String(err).slice(0, 300) } });
            throw err;
        }
    }
    async propagation() {
        const [regs, state] = await Promise.all([this.prisma.productRegistration.findMany({ orderBy: { product: 'asc' } }), this.prisma.controlState.findUnique({ where: { id: 1 } })]);
        const cur = state?.version ?? 1;
        return {
            currentVersion: cur,
            products: regs.map((r) => {
                const age = r.lastFetchedAt ? Math.round((Date.now() - r.lastFetchedAt.getTime()) / 1000) : null;
                return {
                    product: r.product, snapshotVersion: r.lastFetchedVersion, lastFetchedAt: r.lastFetchedAt, ageSeconds: age, versionsBehind: Math.max(0, cur - r.lastFetchedVersion),
                    status: !r.lastFetchedAt ? 'NEVER_FETCHED' : r.lastFetchedVersion >= cur ? 'IN_SYNC' : age !== null && age > 60 ? 'STALE' : 'PROPAGATING',
                    lastPush: { version: r.lastPushedVersion, at: r.lastPushedAt, error: r.lastPushError }, webhookConfigured: !!r.webhookUrl,
                };
            }),
        };
    }
    async listAdmin(opts = {}) {
        const [defs, values, gates, audits] = await Promise.all([
            this.prisma.flagDefinition.findMany({ where: opts.product ? { product: opts.product } : {}, orderBy: [{ product: 'asc' }, { key: 'asc' }] }),
            this.prisma.flagValue.findMany({ where: { value: 'OFF' } }),
            this.prisma.flagGateEvidence.findMany(),
            this.prisma.flagAudit.findMany({ orderBy: { createdAt: 'desc' }, take: 1000 }),
        ]);
        const c = await this.load();
        const market = (opts.market ?? 'EG').toUpperCase();
        return defs.map((d) => {
            const vals = values.filter((v) => v.flagKey === d.key && this.isActive(v, new Date()));
            const global = (0, flag_evaluator_1.evaluateFlag)(c.map, d.key, {});
            const marketEval = (0, flag_evaluator_1.evaluateFlag)(c.map, d.key, { market });
            const src = vals.find((v) => v.scope === 'GLOBAL') ?? vals.find((v) => v.scope === 'MARKET' && v.scopeId === market);
            const last = audits.find((a) => a.flagKey === d.key);
            const ev = gates.filter((g) => g.flagKey === d.key);
            const gate = ev[0];
            const missing = d.launchLocked ? (d.gateIds.length ? d.gateIds.filter((id) => !ev.some((e) => baseGateId(e.gateId) === id)) : ev.length ? [] : ['ANY']) : [];
            return {
                key: d.key, product: d.product, class: d.class, scopes: d.scopes, dependsOn: d.dependsOn, moneyPath: d.moneyPath, launchLocked: d.launchLocked, whenOff: d.whenOff, gateHint: d.gateHint,
                effective: { global: global.effective, market: { [market]: marketEval.effective } },
                state: marketEval.effective ? 'ON' : marketEval.reason === 'AWAITING_GATE' ? 'ON_AWAITING_GATE' : 'OFF',
                reason: marketEval.reason,
                source: src ? { scope: src.scope, scopeId: src.scopeId, reason: src.reason, ticket: src.ticket, setBy: src.setBy, expiresAt: src.expiresAt, at: src.updatedAt } : marketEval.reason === 'AWAITING_GATE' ? { scope: 'GATE' } : marketEval.reason === 'DEPENDENCY_OFF' ? { scope: 'DEPENDENCY', blockedBy: marketEval.blockedBy } : { scope: 'DEFAULT' },
                overrides: vals.map((v) => ({ scope: v.scope, scopeId: v.scopeId, reason: v.reason, ticket: v.ticket, expiresAt: v.expiresAt, startsAt: v.startsAt })),
                gate: gate ? { gateId: gate.gateId, approver: gate.approver, approvedOn: gate.approvedOn, documentUrl: gate.documentUrl } : null,
                gateIds: d.gateIds, edition: d.edition,
                gates: ev.map((e) => ({ gateId: e.gateId, approver: e.approver, approvedOn: e.approvedOn, documentUrl: e.documentUrl })),
                missingGates: missing,
                lastChange: last ? { at: last.createdAt, actor: last.actor, event: last.event, newValue: last.newValue, reason: last.reason } : null,
            };
        });
    }
    auditQuery(q) {
        const where = { ...(q.flagKey ? { flagKey: q.flagKey } : {}), ...(q.from || q.to ? { createdAt: { ...(q.from ? { gte: q.from } : {}), ...(q.to ? { lte: q.to } : {}) } } : {}) };
        return this.prisma.flagAudit.findMany({ where, orderBy: { createdAt: 'desc' }, take: q.limit ?? 1000 });
    }
    toCsv(rows) {
        const cols = ['createdAt', 'flagKey', 'scope', 'scopeId', 'oldValue', 'newValue', 'actor', 'reason', 'ticket', 'expiresAt', 'emergency', 'event'];
        const esc = (v) => `"${String(v instanceof Date ? v.toISOString() : (v ?? '')).replace(/"/g, '""')}"`;
        return [cols.join(','), ...rows.map((r) => cols.map((c) => esc(r[c])).join(','))].join('\n');
    }
};
exports.FlagsService = FlagsService;
exports.FlagsService = FlagsService = FlagsService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, outbox_public_1.OutboxService])
], FlagsService);
//# sourceMappingURL=flags.service.js.map