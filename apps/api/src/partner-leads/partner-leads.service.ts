import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { verifyIntakeSignature } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { ApiError, badRequest, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../common/rate-limit';
import { PrismaService } from '../prisma/prisma.service';
import { LeadAlertsService } from './lead-alerts.service';
import { leadSigningKeys } from './lead-signing';
import { LEAD_KINDS, LEAD_STATUSES, parseFunnelBody, parseLeadBody, type LeadStatus } from './lead-validation';

const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const RANK: Record<string, number> = { NEW: 0, CONTACTED: 1, STARTED: 2, SUBMITTED: 3, LIVE: 4 };
const tooMany = (retryAfterSec: number) => new ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec });
const UNAUTHORIZED = () => new ApiError(401, 'LEAD_UNAUTHORIZED', 'Request could not be authenticated');

export { leadSigningKey } from './lead-signing';
const lim = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };

let limiter: RateLimiter = new SlidingWindowLimiter();
export const resetLeadLimits = async () => { await limiter.reset(); };

/** Rows come back with the status the connection implies (a lead whose organisation submitted or went live shows that). */
const effective = (stored: string, conn: string | undefined, started: boolean): LeadStatus => {
  if (stored === 'CLOSED') return 'CLOSED';
  let r = RANK[stored] ?? 0;
  if (started) r = Math.max(r, RANK.STARTED!);
  if (conn) r = Math.max(r, conn === 'LIVE' ? RANK.LIVE! : RANK.SUBMITTED!);
  return (Object.keys(RANK).find((k) => RANK[k] === r) ?? 'NEW') as LeadStatus;
};

@Injectable()
export class PartnerLeadsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('partner-leads');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly alerts: LeadAlertsService) { limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as never); }
  onModuleInit() {
    if (!cfg().jobsEnabled || !(limiter instanceof PgRateLimiter)) return;
    const pg = limiter; this.timer = setInterval(() => void pg.sweep().catch((e) => this.log.warn(`sweep failed: ${e.message}`)), 10 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  /** Uniform 401 for every failure (no key, bad signature, stale timestamp, replayed nonce). Nonce is stored only after a valid signature. */
  private async authenticate(raw: string, h: { signature?: string; timestamp?: string }, nonceKey: string, ip: string) {
    // current secret first, then the previous one while a rotation window is open (PARTNER_LEAD_SIGNING_SECRET="new,old")
    let ok = false;
    for (const signingKey of leadSigningKeys()) if (verifyIntakeSignature({ signingKey, body: raw, timestamp: h.timestamp, signature: h.signature })) ok = true;
    if (ok) { try { await this.prisma.partnerIntakeNonce.create({ data: { id: sha(`lead|${nonceKey}`) } }); } catch { ok = false; } }
    if (!ok) { await limiter.hit(`lfail:${ip}`, 1_000_000, 600_000); throw UNAUTHORIZED(); }
  }
  private async guard(ip: string, bucket: 'lead' | 'funnel') {
    const f = await limiter.blocked(`lfail:${ip}`, lim('LEAD_RATE_FAILED_PER_10MIN', 12), 600_000); if (!f.ok) throw tooMany(f.retryAfterSec);
    const a = await limiter.hit(`l${bucket}:${ip}`, bucket === 'lead' ? lim('LEAD_RATE_IP_PER_MIN', 10) : lim('LEAD_FUNNEL_RATE_IP_PER_MIN', 60), 60_000); if (!a.ok) throw tooMany(a.retryAfterSec);
  }

  /** POST /partners/v1/leads: shape (400) -> rate limits (429) -> signature (401) -> upsert per (kind, orgRef). */
  async submitLead(raw: string, h: { signature?: string; timestamp?: string; ip?: string }) {
    const ip = h.ip ?? 'unknown'; await this.guard(ip, 'lead');
    const b = parseLeadBody(raw);
    const o = await limiter.hit(`lead-org:${b.kind}:${b.orgRef}`, lim('LEAD_RATE_ORG_PER_HOUR', 5), 3_600_000); if (!o.ok) throw tooMany(o.retryAfterSec);
    await this.authenticate(raw, h, `${b.kind}|${b.orgRef}|${b.nonce}`, ip);
    const data = { orgName: b.orgName, contactName: b.contactName, contactRole: b.contactRole ?? null, phone: b.phone ?? null, email: b.email ?? null, preferredTime: b.preferredTime ?? null, note: b.note ?? null, locale: b.locale, market: b.market, consentAt: new Date() };
    const existing = await this.prisma.partnerLead.findUnique({ where: { kind_orgRef: { kind: b.kind, orgRef: b.orgRef } } });
    // a repeat request refreshes the contact details and re-opens a CLOSED lead; progress is never lowered
    const r = existing
      ? await this.prisma.partnerLead.update({ where: { id: existing.id }, data: { ...data, ...(existing.status === 'CLOSED' ? { status: 'NEW' } : {}) } })
      : await this.prisma.partnerLead.create({ data: { id: newId('pl'), kind: b.kind, orgRef: b.orgRef, ...data } });
    if (!existing || existing.status === 'CLOSED') await this.alerts.onLead({ id: r.id, kind: r.kind, orgName: r.orgName }, existing ? r.updatedAt : r.createdAt); // new or re-opened only; a plain refresh never alerts again
    await this.prisma.partnerFunnelMark.upsert({ where: { kind_orgRef_stage: { kind: b.kind, orgRef: b.orgRef, stage: 'INTERESTED' } }, create: { kind: b.kind, orgRef: b.orgRef, stage: 'INTERESTED' }, update: {} });
    await this.prisma.auditLog.create({ data: { actor: 'partner', action: 'partner_lead.submitted', resource: 'PartnerLead', resourceId: r.id, metadata: { kind: b.kind, created: !existing } as never } }).catch(() => undefined);
    return { id: r.id, created: !existing };
  }

  /** POST /partners/v1/funnel: a counter marker (kind + org id + stage). Idempotent. */
  async markFunnel(raw: string, h: { signature?: string; timestamp?: string; ip?: string }) {
    const ip = h.ip ?? 'unknown'; await this.guard(ip, 'funnel');
    const b = parseFunnelBody(raw);
    const o = await limiter.hit(`funnel-org:${b.kind}:${b.orgRef}`, lim('LEAD_FUNNEL_RATE_ORG_PER_HOUR', 30), 3_600_000); if (!o.ok) throw tooMany(o.retryAfterSec);
    await this.authenticate(raw, h, `${b.kind}|${b.orgRef}|${b.nonce}`, ip);
    await this.prisma.partnerFunnelMark.upsert({ where: { kind_orgRef_stage: { kind: b.kind, orgRef: b.orgRef, stage: b.stage } }, create: { kind: b.kind, orgRef: b.orgRef, stage: b.stage }, update: {} });
    return { ok: true };
  }

  // ───────────────────────── ops console ─────────────────────────

  private async connections(keys: Array<{ kind: string; orgRef: string }>) {
    if (!keys.length) return new Map<string, { id: string; status: string }>();
    const rows = await this.prisma.partnerConnection.findMany({ where: { OR: keys.map((k) => ({ kind: k.kind, orgRef: k.orgRef })) }, select: { id: true, kind: true, orgRef: true, status: true } });
    return new Map(rows.map((r) => [`${r.kind}|${r.orgRef}`, { id: r.id, status: r.status }]));
  }

  async list(f: { status?: string; kind?: string }) {
    if (f.status && !(LEAD_STATUSES as readonly string[]).includes(f.status)) throw badRequest('INVALID_STATUS', 'Unknown status');
    if (f.kind && !(LEAD_KINDS as readonly string[]).includes(f.kind)) throw badRequest('INVALID_KIND', 'Unknown kind');
    const rows = await this.prisma.partnerLead.findMany({ where: { ...(f.kind ? { kind: f.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 500 });
    const conns = await this.connections(rows);
    const marks = rows.length ? await this.prisma.partnerFunnelMark.findMany({ where: { stage: 'STARTED', OR: rows.map((r) => ({ kind: r.kind, orgRef: r.orgRef })) } }) : [];
    const started = new Set(marks.map((m) => `${m.kind}|${m.orgRef}`));
    const out = rows.map((r) => { const c = conns.get(`${r.kind}|${r.orgRef}`); return this.view(r, c, started.has(`${r.kind}|${r.orgRef}`)); });
    return f.status ? out.filter((r) => r.status === f.status) : out;
  }

  private view(r: { id: string; kind: string; orgRef: string; orgName: string; contactName: string; contactRole: string | null; phone: string | null; email: string | null; preferredTime: string | null; note: string | null; locale: string; market: string; consentAt: Date; status: string; assignee: string | null; notes: unknown; createdAt: Date; updatedAt: Date }, conn: { id: string; status: string } | undefined, started: boolean) {
    return { id: r.id, kind: r.kind, orgRef: r.orgRef, orgName: r.orgName, contactName: r.contactName, contactRole: r.contactRole, phone: r.phone, email: r.email, preferredTime: r.preferredTime, note: r.note, locale: r.locale, market: r.market, consentAt: r.consentAt, status: effective(r.status, conn?.status, started), assignee: r.assignee, notes: (Array.isArray(r.notes) ? r.notes : []) as Array<{ at: string; by: string; text: string }>, connectionId: conn?.id ?? null, connectionStatus: conn?.status ?? null, createdAt: r.createdAt, updatedAt: r.updatedAt };
  }

  private async one(id: string) { const r = await this.prisma.partnerLead.findUnique({ where: { id } }); if (!r) throw notFound('PARTNER_LEAD_NOT_FOUND', 'Lead not found'); return r; }
  private async viewOne(id: string) { const r = await this.one(id); const c = (await this.connections([r])).get(`${r.kind}|${r.orgRef}`); const m = await this.prisma.partnerFunnelMark.findUnique({ where: { kind_orgRef_stage: { kind: r.kind, orgRef: r.orgRef, stage: 'STARTED' } } }); return this.view(r, c, !!m); }

  async update(actor: string, id: string, b: { status?: string; assignee?: string | null }) {
    const r = await this.one(id);
    const data: Record<string, unknown> = {};
    if (b.status !== undefined) { if (!(LEAD_STATUSES as readonly string[]).includes(b.status)) throw badRequest('INVALID_STATUS', 'Unknown status'); data.status = b.status; }
    if (b.assignee !== undefined) data.assignee = b.assignee ? b.assignee.trim().slice(0, 80) : null;
    await this.prisma.partnerLead.update({ where: { id }, data });
    await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.updated', resource: 'PartnerLead', resourceId: id, metadata: { from: r.status, status: b.status, assignee: b.assignee !== undefined } as never } });
    return this.viewOne(id);
  }

  async addNote(actor: string, id: string, text: string) {
    const r = await this.one(id); const t = (text ?? '').trim();
    if (!t || t.length > 1000) throw badRequest('INVALID_REQUEST', 'Note must be 1-1000 characters', { field: 'text' });
    const notes = [...(Array.isArray(r.notes) ? (r.notes as unknown[]) : []), { at: new Date().toISOString(), by: actor, text: t }].slice(-100);
    await this.prisma.partnerLead.update({ where: { id }, data: { notes: notes as never } });
    await this.prisma.auditLog.create({ data: { actor, action: 'partner_lead.note_added', resource: 'PartnerLead', resourceId: id } });
    return this.viewOne(id);
  }

  /**
   * Funnel over the last `days` days: distinct organisations per stage. A later stage implies the earlier ones (an organisation that submitted was also interested).
   * interested = viewed the tab, asked to talk, started, submitted or live; started = opened the wizard (marker) or submitted; submitted = has a connection request; live = connection LIVE.
   */
  async funnel(days: number, kind?: string) {
    const d = Math.min(Math.max(Math.floor(days) || 30, 1), 365); const since = new Date(Date.now() - d * 86_400_000);
    if (kind && !(LEAD_KINDS as readonly string[]).includes(kind)) throw badRequest('INVALID_KIND', 'Unknown kind');
    const kf = kind ? { kind } : {};
    const [marks, leads, conns] = await Promise.all([
      this.prisma.partnerFunnelMark.findMany({ where: { firstAt: { gte: since }, ...kf } }),
      this.prisma.partnerLead.findMany({ where: { createdAt: { gte: since }, ...kf }, select: { kind: true, orgRef: true } }),
      this.prisma.partnerConnection.findMany({ where: { createdAt: { gte: since }, ...kf }, select: { kind: true, orgRef: true, status: true } }),
    ]);
    const k = (x: { kind: string; orgRef: string }) => `${x.kind}|${x.orgRef}`;
    const live = new Set(conns.filter((c) => c.status === 'LIVE').map(k));
    const submitted = new Set([...conns.map(k)]);
    const started = new Set([...marks.filter((m) => m.stage === 'STARTED').map(k), ...submitted]);
    const interested = new Set([...marks.filter((m) => m.stage === 'INTERESTED').map(k), ...leads.map(k), ...started]);
    const talk = new Set(leads.map(k));
    const pct = (a: number, b: number) => (b > 0 ? Math.round((a / b) * 1000) / 10 : null);
    const rows = [['interested', interested.size], ['started', started.size], ['submitted', submitted.size], ['live', live.size]] as const;
    const byKind: Record<string, { interested: number; started: number; submitted: number; live: number }> = {};
    for (const kd of LEAD_KINDS) { const has = (s: Set<string>) => [...s].filter((x) => x.startsWith(`${kd}|`)).length; byKind[kd] = { interested: has(interested), started: has(started), submitted: has(submitted), live: has(live) }; }
    return {
      days: d, since: since.toISOString(), talkToUs: talk.size,
      stages: rows.map(([stage, count], i) => ({ stage, count, fromPrevious: i === 0 ? null : pct(count, rows[i - 1]![1]), fromInterested: i === 0 ? null : pct(count, rows[0][1]) })),
      byKind,
    };
  }
}
