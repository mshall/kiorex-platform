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
exports.PartnerLeadsService = exports.resetLeadLimits = exports.leadSigningKey = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const contracts_1 = require("@kiorex/contracts");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const rate_limit_1 = require("../common/rate-limit");
const prisma_service_1 = require("../prisma/prisma.service");
const lead_alerts_service_1 = require("./lead-alerts.service");
const lead_signing_1 = require("./lead-signing");
const lead_validation_1 = require("./lead-validation");
const sha = (s) => (0, node_crypto_1.createHash)('sha256').update(s).digest('hex');
const RANK = { NEW: 0, CONTACTED: 1, STARTED: 2, SUBMITTED: 3, LIVE: 4 };
const tooMany = (retryAfterSec) => new errors_1.ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec });
const UNAUTHORIZED = () => new errors_1.ApiError(401, 'LEAD_UNAUTHORIZED', 'Request could not be authenticated');
var lead_signing_2 = require("./lead-signing");
Object.defineProperty(exports, "leadSigningKey", { enumerable: true, get: function () { return lead_signing_2.leadSigningKey; } });
const lim = (name, def) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
let limiter = new rate_limit_1.SlidingWindowLimiter();
const resetLeadLimits = async () => { await limiter.reset(); };
exports.resetLeadLimits = resetLeadLimits;
const effective = (stored, conn, started) => {
    if (stored === 'CLOSED')
        return 'CLOSED';
    let r = RANK[stored] ?? 0;
    if (started)
        r = Math.max(r, RANK.STARTED);
    if (conn)
        r = Math.max(r, conn === 'LIVE' ? RANK.LIVE : RANK.SUBMITTED);
    return (Object.keys(RANK).find((k) => RANK[k] === r) ?? 'NEW');
};
let PartnerLeadsService = class PartnerLeadsService {
    prisma;
    alerts;
    log = new common_1.Logger('partner-leads');
    timer;
    constructor(prisma, alerts) {
        this.prisma = prisma;
        this.alerts = alerts;
        limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new rate_limit_1.SlidingWindowLimiter() : new rate_limit_1.PgRateLimiter(prisma);
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled || !(limiter instanceof rate_limit_1.PgRateLimiter))
            return;
        const pg = limiter;
        this.timer = setInterval(() => void pg.sweep().catch((e) => this.log.warn(`sweep failed: ${e.message}`)), 10 * 60_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    async authenticate(raw, h, nonceKey, ip) {
        let ok = false;
        for (const signingKey of (0, lead_signing_1.leadSigningKeys)())
            if ((0, contracts_1.verifyIntakeSignature)({ signingKey, body: raw, timestamp: h.timestamp, signature: h.signature }))
                ok = true;
        if (ok) {
            try {
                await this.prisma.partnerIntakeNonce.create({ data: { id: sha(`lead|${nonceKey}`) } });
            }
            catch {
                ok = false;
            }
        }
        if (!ok) {
            await limiter.hit(`lfail:${ip}`, 1_000_000, 600_000);
            throw UNAUTHORIZED();
        }
    }
    async guard(ip, bucket) {
        const f = await limiter.blocked(`lfail:${ip}`, lim('LEAD_RATE_FAILED_PER_10MIN', 12), 600_000);
        if (!f.ok)
            throw tooMany(f.retryAfterSec);
        const a = await limiter.hit(`l${bucket}:${ip}`, bucket === 'lead' ? lim('LEAD_RATE_IP_PER_MIN', 10) : lim('LEAD_FUNNEL_RATE_IP_PER_MIN', 60), 60_000);
        if (!a.ok)
            throw tooMany(a.retryAfterSec);
    }
    async submitLead(raw, h) {
        const ip = h.ip ?? 'unknown';
        await this.guard(ip, 'lead');
        const b = (0, lead_validation_1.parseLeadBody)(raw);
        const o = await limiter.hit(`lead-org:${b.kind}:${b.orgRef}`, lim('LEAD_RATE_ORG_PER_HOUR', 5), 3_600_000);
        if (!o.ok)
            throw tooMany(o.retryAfterSec);
        await this.authenticate(raw, h, `${b.kind}|${b.orgRef}|${b.nonce}`, ip);
        const data = { orgName: b.orgName, contactName: b.contactName, contactRole: b.contactRole ?? null, phone: b.phone ?? null, email: b.email ?? null, preferredTime: b.preferredTime ?? null, note: b.note ?? null, locale: b.locale, market: b.market, consentAt: new Date() };
        const existing = await this.prisma.partnerLead.findUnique({ where: { kind_orgRef: { kind: b.kind, orgRef: b.orgRef } } });
        const r = existing
            ? await this.prisma.partnerLead.update({ where: { id: existing.id }, data: { ...data, ...(existing.status === 'CLOSED' ? { status: 'NEW' } : {}) } })
            : await this.prisma.partnerLead.create({ data: { id: (0, ids_1.newId)('pl'), kind: b.kind, orgRef: b.orgRef, ...data } });
        if (!existing || existing.status === 'CLOSED')
            await this.alerts.onLead({ id: r.id, kind: r.kind, orgName: r.orgName }, existing ? r.updatedAt : r.createdAt);
        await this.prisma.partnerFunnelMark.upsert({ where: { kind_orgRef_stage: { kind: b.kind, orgRef: b.orgRef, stage: 'INTERESTED' } }, create: { kind: b.kind, orgRef: b.orgRef, stage: 'INTERESTED' }, update: {} });
        await this.prisma.auditLog.create({ data: { actor: 'partner', action: 'partner_lead.submitted', resource: 'PartnerLead', resourceId: r.id, metadata: { kind: b.kind, created: !existing } } }).catch(() => undefined);
        return { id: r.id, created: !existing };
    }
    async markFunnel(raw, h) {
        const ip = h.ip ?? 'unknown';
        await this.guard(ip, 'funnel');
        const b = (0, lead_validation_1.parseFunnelBody)(raw);
        const o = await limiter.hit(`funnel-org:${b.kind}:${b.orgRef}`, lim('LEAD_FUNNEL_RATE_ORG_PER_HOUR', 30), 3_600_000);
        if (!o.ok)
            throw tooMany(o.retryAfterSec);
        await this.authenticate(raw, h, `${b.kind}|${b.orgRef}|${b.nonce}`, ip);
        await this.prisma.partnerFunnelMark.upsert({ where: { kind_orgRef_stage: { kind: b.kind, orgRef: b.orgRef, stage: b.stage } }, create: { kind: b.kind, orgRef: b.orgRef, stage: b.stage }, update: {} });
        return { ok: true };
    }
    async connections(keys) {
        if (!keys.length)
            return new Map();
        const rows = await this.prisma.partnerConnection.findMany({ where: { OR: keys.map((k) => ({ kind: k.kind, orgRef: k.orgRef })) }, select: { id: true, kind: true, orgRef: true, status: true } });
        return new Map(rows.map((r) => [`${r.kind}|${r.orgRef}`, { id: r.id, status: r.status }]));
    }
    async list(f) {
        if (f.status && !lead_validation_1.LEAD_STATUSES.includes(f.status))
            throw (0, errors_1.badRequest)('INVALID_STATUS', 'Unknown status');
        if (f.kind && !lead_validation_1.LEAD_KINDS.includes(f.kind))
            throw (0, errors_1.badRequest)('INVALID_KIND', 'Unknown kind');
        const rows = await this.prisma.partnerLead.findMany({ where: { ...(f.kind ? { kind: f.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
        const conns = await this.connections(rows);
        const marks = rows.length ? await this.prisma.partnerFunnelMark.findMany({ where: { stage: 'STARTED', OR: rows.map((r) => ({ kind: r.kind, orgRef: r.orgRef })) } }) : [];
        const started = new Set(marks.map((m) => `${m.kind}|${m.orgRef}`));
        const out = rows.map((r) => { const c = conns.get(`${r.kind}|${r.orgRef}`); return this.view(r, c, started.has(`${r.kind}|${r.orgRef}`)); });
        return f.status ? out.filter((r) => r.status === f.status) : out;
    }
    view(r, conn, started) {
        return { id: r.id, kind: r.kind, orgRef: r.orgRef, orgName: r.orgName, contactName: r.contactName, contactRole: r.contactRole, phone: r.phone, email: r.email, preferredTime: r.preferredTime, note: r.note, locale: r.locale, market: r.market, consentAt: r.consentAt, status: effective(r.status, conn?.status, started), assignee: r.assignee, notes: (Array.isArray(r.notes) ? r.notes : []), connectionId: conn?.id ?? null, connectionStatus: conn?.status ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt };
    }
    async one(id) { const r = await this.prisma.partnerLead.findUnique({ where: { id } }); if (!r)
        throw (0, errors_1.notFound)('PARTNER_LEAD_NOT_FOUND', 'Lead not found'); return r; }
    async viewOne(id) { const r = await this.one(id); const c = (await this.connections([r])).get(`${r.kind}|${r.orgRef}`); const m = await this.prisma.partnerFunnelMark.findUnique({ where: { kind_orgRef_stage: { kind: r.kind, orgRef: r.orgRef, stage: 'STARTED' } } }); return this.view(r, c, !!m); }
    async update(actor, id, b) {
        const r = await this.one(id);
        const data = {};
        if (b.status !== undefined) {
            if (!lead_validation_1.LEAD_STATUSES.includes(b.status))
                throw (0, errors_1.badRequest)('INVALID_STATUS', 'Unknown status');
            data.status = b.status;
        }
        if (b.assignee !== undefined)
            data.assignee = b.assignee ? b.assignee.trim().slice(0, 80) : null;
        await this.prisma.partnerLead.update({ where: { id }, data });
        await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.updated', resource: 'PartnerLead', resourceId: id, metadata: { from: r.status, status: b.status, assignee: b.assignee !== undefined } } });
        return this.viewOne(id);
    }
    async addNote(actor, id, text) {
        const r = await this.one(id);
        const t = (text ?? '').trim();
        if (!t || t.length > 1000)
            throw (0, errors_1.badRequest)('INVALID_REQUEST', 'Note must be 1-1000 characters', { field: 'text' });
        const notes = [...(Array.isArray(r.notes) ? r.notes : []), { at: new Date().toISOString(), by: actor, text: t }].slice(-100);
        await this.prisma.partnerLead.update({ where: { id }, data: { notes: notes } });
        await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.note_added', resource: 'PartnerLead', resourceId: id } });
        return this.viewOne(id);
    }
    async funnel(days, kind) {
        const d = Math.min(Math.max(Math.floor(days) || 30, 1), 365);
        const since = new Date(Date.now() - d * 86_400_000);
        if (kind && !lead_validation_1.LEAD_KINDS.includes(kind))
            throw (0, errors_1.badRequest)('INVALID_KIND', 'Unknown kind');
        const kf = kind ? { kind } : {};
        const [marks, leads, conns] = await Promise.all([
            this.prisma.partnerFunnelMark.findMany({ where: { firstAt: { gte: since }, ...kf } }),
            this.prisma.partnerLead.findMany({ where: { createdAt: { gte: since }, ...kf }, select: { kind: true, orgRef: true } }),
            this.prisma.partnerConnection.findMany({ where: { createdAt: { gte: since }, ...kf }, select: { kind: true, orgRef: true, status: true } }),
        ]);
        const k = (x) => `${x.kind}|${x.orgRef}`;
        const live = new Set(conns.filter((c) => c.status === 'LIVE').map(k));
        const submitted = new Set([...conns.map(k)]);
        const started = new Set([...marks.filter((m) => m.stage === 'STARTED').map(k), ...submitted]);
        const interested = new Set([...marks.filter((m) => m.stage === 'INTERESTED').map(k), ...leads.map(k), ...started]);
        const talk = new Set(leads.map(k));
        const pct = (a, b) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
        const rows = [['interested', interested.size], ['started', started.size], ['submitted', submitted.size], ['live', live.size]];
        const byKind = {};
        for (const kd of lead_validation_1.LEAD_KINDS) {
            const has = (s) => [...s].filter((x) => x.startsWith(`${kd}|`)).length;
            byKind[kd] = { interested: has(interested), started: has(started), submitted: has(submitted), live: has(live) };
        }
        return {
            days: d, since: since.toISOString(), talkToUs: talk.size,
            stages: rows.map(([stage, count], i) => ({ stage, count, fromPrevious: i === 0 ? null : pct(count, rows[i - 1][1]), fromInterested: i === 0 ? null : pct(count, rows[0][1]) })),
            byKind,
        };
    }
};
exports.PartnerLeadsService = PartnerLeadsService;
exports.PartnerLeadsService = PartnerLeadsService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, lead_alerts_service_1.LeadAlertsService])
], PartnerLeadsService);
//# sourceMappingURL=partner-leads.service.js.map