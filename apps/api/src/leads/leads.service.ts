import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { cfg } from '../common/config';
import { blindIndex, decryptField, encryptField } from '../common/crypto';
import { ApiError, badRequest, conflict, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { PgRateLimiter, SlidingWindowLimiter, type RateLimiter } from '../common/rate-limit';
import { OPS_ROLES, type AuthUser } from '../common/auth';
import { maskRecipient } from '../messaging/messaging-public';
import { PrismaService } from '../prisma/prisma.service';
import { LeadConfigService } from './lead-config.service';
import { LEAD_STATUSES, LEAD_TRANSITIONS, LICENCE_FIELDS, REQUIRABLE_FIELDS, TYPE_FIELDS, type LeadConfig, type LeadStatus } from './lead-config';
import { toCsv } from './lead-csv';
import { LeadNotifier } from './lead-notifier';
import { looksLikeTest, parseSubmission, payloadHashOf, type ParsedLead } from './lead-validation';

const lim = (name: string, def: number) => { const n = Number(process.env[name]); return Number.isFinite(n) && n > 0 ? n : def; };
const tooMany = (retryAfterSec: number) => new ApiError(429, 'RATE_LIMITED', 'Too many requests, try again later', { retryAfterSec });
const REF_ALPHABET = 'ABCDEFGHJKMNPQRSTVWXYZ23456789'; // no 0 O 1 I L U: readable over the phone
const newRef = () => `KL-${Array.from(randomBytes(8), (b) => REF_ALPHABET[b % REF_ALPHABET.length]).join('')}`;
const KEY = /^[A-Za-z0-9_-]{8,64}$/;
const MAX_EXPORT = 5000;
const PAGE_MAX = 100;

let limiter: RateLimiter = new SlidingWindowLimiter();
export const resetLeadSubmissionLimits = async () => { await limiter.reset(); };

type Row = NonNullable<Awaited<ReturnType<PrismaService['lead']['findUnique']>>>;
interface Filters { status?: string; type?: string; market?: string; mode?: string; from?: string; to?: string; q?: string; owner?: string; test?: string; duplicates?: string; page?: string; pageSize?: string }

/** Plain text and licence numbers never reach a log line: only ids and counts. */
@Injectable()
export class LeadsService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('leads');
  private timer?: NodeJS.Timeout;
  constructor(private readonly prisma: PrismaService, private readonly config: LeadConfigService, private readonly notifier: LeadNotifier) {
    limiter = process.env.RATE_LIMIT_STORE === 'memory' ? new SlidingWindowLimiter() : new PgRateLimiter(prisma as never);
  }
  onModuleInit() {
    if (!cfg().jobsEnabled || !(limiter instanceof PgRateLimiter)) return;
    const pg = limiter; this.timer = setInterval(() => void pg.sweep().catch(() => undefined), 10 * 60_000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  // ───────────────────────── public intake ─────────────────────────

  async publicConfig() {
    const c = await this.config.current();
    const on = <T extends { active: boolean }>(l: T[]) => l.filter((x) => x.active);
    const typeFields = Object.fromEntries(on(c.providerTypes).map((t) => { const s = TYPE_FIELDS[t.key] ?? TYPE_FIELDS.OTHER!; return [t.key, { fields: s.fields, answers: s.answers, minBranches: s.minBranches ?? null }]; }));
    return {
      providerTypes: on(c.providerTypes), specialties: on(c.specialties), modules: on(c.modules), goLive: on(c.goLive), software: on(c.software), contactChannels: on(c.contactChannels), contactTimes: on(c.contactTimes),
      markets: on(c.markets).map((m) => ({ ...m, governorates: on(m.governorates) })), requiredFields: c.requiredFields, typeFields, modes: ['STANDALONE', 'CONNECTED'],
      limits: { note: 1000, legalName: 120, services: 300, licence: 40 },
    };
  }

  /** POST /public/leads. Order: size (middleware) -> abuse check -> idempotency replay -> validation -> rate limits -> store -> notify (best effort). */
  async submit(body: unknown, h: { idempotencyKey?: string; ip?: string }) {
    const ip = h.ip ?? 'unknown'; const ipKey = blindIndex(`lead-ip:${ip}`).slice(0, 32);
    const key = (h.idempotencyKey ?? '').trim();
    if (!KEY.test(key)) throw badRequest('IDEMPOTENCY_KEY_REQUIRED', 'Send an Idempotency-Key header of 8 to 64 letters, digits, - or _');
    const bad = await limiter.blocked(`lead-bad:${ipKey}`, lim('LEADS_RATE_INVALID_PER_10MIN', 30), 600_000); if (!bad.ok) throw tooMany(bad.retryAfterSec);
    const blocked = await limiter.blocked(`lead-ip10:${ipKey}`, lim('LEADS_RATE_IP_PER_10MIN', 6), 600_000); if (!blocked.ok) throw tooMany(blocked.retryAfterSec);

    const config = await this.config.current();
    const { errors, value } = parseSubmission(body, config);
    if (!value) {
      await limiter.hit(`lead-bad:${ipKey}`, 1_000_000, 600_000);
      throw badRequest('VALIDATION_FAILED', 'Some fields are missing or invalid', { fields: errors });
    }
    // bots fill the hidden field: answer exactly like a success, store nothing
    if (value.honeypot) { await limiter.hit(`lead-bad:${ipKey}`, 1_000_000, 600_000); return { reference: newRef(), status: 'RECEIVED', replayed: false }; }

    const hash = payloadHashOf(value);
    const prior = await this.prisma.lead.findUnique({ where: { idempotencyKey: key }, select: { ref: true, payloadHash: true } });
    if (prior) {
      if (prior.payloadHash !== hash) throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request');
      return { reference: prior.ref, status: 'RECEIVED', replayed: true };
    }
    const g = await limiter.hit('lead-global', lim('LEADS_RATE_GLOBAL_PER_HOUR', 300), 3_600_000); if (!g.ok) throw tooMany(g.retryAfterSec);
    const a = await limiter.hit(`lead-ip10:${ipKey}`, lim('LEADS_RATE_IP_PER_10MIN', 6), 600_000); if (!a.ok) throw tooMany(a.retryAfterSec);
    const d = await limiter.hit(`lead-ipday:${ipKey}`, lim('LEADS_RATE_IP_PER_DAY', 20), 86_400_000); if (!d.ok) throw tooMany(d.retryAfterSec);
    const phoneHash = blindIndex(`lead-phone:${value.phone}`);
    const p = await limiter.hit(`lead-phone:${phoneHash.slice(0, 32)}`, lim('LEADS_RATE_PHONE_PER_DAY', 3), 86_400_000); if (!p.ok) throw tooMany(p.retryAfterSec);

    const emailHash = value.email ? blindIndex(`lead-email:${value.email}`) : null;
    const test = looksLikeTest(value, config);
    const dupOf = await this.findDuplicate(phoneHash, emailHash, test);
    let created: Row | null = null;
    for (let i = 0; i < 3 && !created; i++) {
      try {
        created = await this.prisma.lead.create({
          data: {
            id: newId('ld'), ref: newRef(), mode: value.mode, providerType: value.providerType, legalName: value.legalName, tradeName: value.tradeName ?? null,
            contactNameEnc: encryptField(value.contactName), contactRole: value.contactRole ?? null, phoneEnc: encryptField(value.phone), phoneHash,
            emailEnc: value.email ? encryptField(value.email) : null, emailHash, country: value.market, governorate: value.governorate ?? null, city: value.city ?? null, market: value.market,
            branches: value.branches ?? null, staffCount: value.staffCount ?? null, specialties: value.specialties, services: value.services ?? null, currentSoftware: value.currentSoftware ?? null,
            licencesEnc: Object.keys(value.licences).length ? encryptField(JSON.stringify(value.licences)) : null, modules: value.modules, goLive: value.goLive ?? null, locale: value.locale,
            contactChannel: value.contactChannel ?? null, contactTime: value.contactTime ?? null, noteEnc: value.note ? encryptField(value.note) : null, extra: value.extra as never,
            consentTextVersion: value.consentTextVersion, consentAt: new Date(), sourceEnv: value.sourceEnv ?? null, idempotencyKey: key, payloadHash: hash, ipHash: ipKey,
            tags: [...(test ? ['test'] : []), ...(dupOf ? ['duplicate'] : [])], isTest: test, duplicateOfId: dupOf?.id ?? null,
          },
        });
      } catch (e) {
        if ((e as { code?: string }).code !== 'P2002') throw e;
        const won = await this.prisma.lead.findUnique({ where: { idempotencyKey: key }, select: { ref: true, payloadHash: true } });
        if (won) { // a concurrent retry of the same submission won the race
          if (won.payloadHash === hash) return { reference: won.ref, status: 'RECEIVED', replayed: true };
          throw conflict('IDEMPOTENCY_KEY_REUSED', 'This Idempotency-Key was used for a different request');
        } // otherwise a reference collision: draw another
      }
    }
    if (!created) throw new ApiError(503, 'TRY_AGAIN', 'Please try again');
    await this.prisma.leadEvent.create({ data: { id: newId('le'), leadId: created.id, kind: 'CREATED', actor: 'public', data: { mode: value.mode, providerType: value.providerType, locale: value.locale, test, duplicateOf: dupOf?.id ?? null } as never } });
    if (dupOf) await this.prisma.leadEvent.create({ data: { id: newId('le'), leadId: dupOf.id, kind: 'DUPLICATE', actor: 'system', data: { newLeadId: created.id, newRef: created.ref } as never } });
    if (!test || process.env.LEADS_NOTIFY_TEST === 'true') void this.notifier.onNewLead({ id: created.id, ref: created.ref, providerType: value.providerType, mode: value.mode, locale: value.locale, email: value.email }, config);
    this.log.log(`lead created id=${created.id} ref=${created.ref} type=${value.providerType} mode=${value.mode}${test ? ' test' : ''}${dupOf ? ' duplicate' : ''}`);
    return { reference: created.ref, status: 'RECEIVED', replayed: false };
  }

  private async findDuplicate(phoneHash: string, emailHash: string | null, isTest: boolean) {
    const m = await this.prisma.lead.findFirst({ where: { isTest, OR: [{ phoneHash }, ...(emailHash ? [{ emailHash }] : [])] }, orderBy: { createdAt: 'asc' }, select: { id: true, duplicateOfId: true } });
    return m ? { id: m.duplicateOfId ?? m.id } : null;
  }

  // ───────────────────────── admin ─────────────────────────

  private dec(s: string | null): string | null { if (!s) return null; try { return decryptField(s); } catch { return null; } }
  private licences(r: Row): Record<string, string> { const j = this.dec(r.licencesEnc); try { return j ? JSON.parse(j) : {}; } catch { return {}; } }

  private summary(r: Row) {
    const phone = this.dec(r.phoneEnc);
    return {
      id: r.id, ref: r.ref, status: r.status, mode: r.mode, providerType: r.providerType, legalName: r.legalName, tradeName: r.tradeName, contactName: this.dec(r.contactNameEnc),
      phoneMasked: phone ? maskRecipient('SMS', phone) : null, hasEmail: !!r.emailEnc, market: r.market, governorate: r.governorate, city: r.city, modules: r.modules, locale: r.locale,
      ownerSub: r.ownerSub, ownerName: r.ownerName, tags: r.tags, isTest: r.isTest, duplicateOfId: r.duplicateOfId, createdAt: r.createdAt, updatedAt: r.updatedAt,
    };
  }

  private where(f: Filters) {
    const w: Record<string, unknown> = {};
    if (f.status) { if (!(LEAD_STATUSES as readonly string[]).includes(f.status)) throw badRequest('INVALID_STATUS', 'Unknown status'); w.status = f.status; }
    if (f.type) w.providerType = f.type;
    if (f.market) w.market = f.market.toUpperCase();
    if (f.mode) { if (!['STANDALONE', 'CONNECTED'].includes(f.mode)) throw badRequest('INVALID_MODE', 'Unknown mode'); w.mode = f.mode; }
    if (f.owner) w.ownerSub = f.owner === 'none' ? null : f.owner;
    if (f.test === 'only') w.isTest = true; else if (f.test === 'exclude') w.isTest = false;
    if (f.duplicates === 'only') w.duplicateOfId = { not: null };
    const day = (s: string, end: boolean) => { if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) throw badRequest('INVALID_DATE', 'Dates are YYYY-MM-DD'); const d = new Date(`${s}T${end ? '23:59:59.999' : '00:00:00.000'}Z`); if (Number.isNaN(d.getTime())) throw badRequest('INVALID_DATE', 'Dates are YYYY-MM-DD'); return d; };
    if (f.from || f.to) w.createdAt = { ...(f.from ? { gte: day(f.from, false) } : {}), ...(f.to ? { lte: day(f.to, true) } : {}) };
    const q = (f.q ?? '').trim().slice(0, 100);
    if (q) {
      const or: unknown[] = [{ ref: { startsWith: q.toUpperCase() } }, { legalName: { contains: q, mode: 'insensitive' } }, { tradeName: { contains: q, mode: 'insensitive' } }];
      if (/^[+\d\s-]{7,20}$/.test(q)) { const t = q.replace(/[\s-]/g, ''); or.push({ phoneHash: blindIndex(`lead-phone:${t.startsWith('+') ? t : `+${t}`}`) }, { phoneHash: blindIndex(`lead-phone:+20${t.replace(/^0+/, '')}`) }); }
      if (q.includes('@')) or.push({ emailHash: blindIndex(`lead-email:${q.toLowerCase()}`) });
      w.OR = or;
    }
    return w;
  }

  async list(f: Filters) {
    const where = this.where(f);
    const pageSize = Math.min(Math.max(parseInt(f.pageSize ?? '25', 10) || 25, 1), PAGE_MAX);
    const page = Math.max(parseInt(f.page ?? '1', 10) || 1, 1);
    const [total, rows] = await Promise.all([
      this.prisma.lead.count({ where: where as never }),
      this.prisma.lead.findMany({ where: where as never, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
    ]);
    return { total, page, pageSize, items: rows.map((r) => this.summary(r)) };
  }

  async summaryCounts() {
    const [groups, newWeek, unassigned, tests] = await Promise.all([
      this.prisma.lead.groupBy({ by: ['status'], where: { isTest: false }, _count: { _all: true } }),
      this.prisma.lead.count({ where: { isTest: false, createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
      this.prisma.lead.count({ where: { isTest: false, ownerSub: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } } }),
      this.prisma.lead.count({ where: { isTest: true } }),
    ]);
    const byStatus = Object.fromEntries(LEAD_STATUSES.map((s) => [s, groups.find((g) => g.status === s)?._count._all ?? 0]));
    return { byStatus, newLastSevenDays: newWeek, unassignedOpen: unassigned, testLeads: tests };
  }

  private async row(id: string) { const r = await this.prisma.lead.findUnique({ where: { id } }); if (!r) throw notFound('LEAD_NOT_FOUND', 'Join request not found'); return r; }

  async detail(u: AuthUser, id: string) {
    const r = await this.row(id);
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'lead.viewed', resource: 'Lead', resourceId: id } }).catch(() => undefined);
    const events = await this.prisma.leadEvent.findMany({ where: { leadId: id }, orderBy: { createdAt: 'asc' }, take: 300 });
    const dupRoot = r.duplicateOfId ?? r.id;
    const dups = await this.prisma.lead.findMany({ where: { OR: [{ id: dupRoot }, { duplicateOfId: dupRoot }], NOT: { id } }, orderBy: { createdAt: 'asc' }, take: 20, select: { id: true, ref: true, status: true, legalName: true, createdAt: true } });
    const spec = TYPE_FIELDS[r.providerType] ?? TYPE_FIELDS.OTHER!;
    return {
      ...this.summary(r), phone: this.dec(r.phoneEnc), email: this.dec(r.emailEnc), contactRole: r.contactRole, country: r.country, branches: r.branches, staffCount: r.staffCount, specialties: r.specialties, services: r.services,
      currentSoftware: r.currentSoftware, licences: this.licences(r), goLive: r.goLive, contactChannel: r.contactChannel, contactTime: r.contactTime, note: this.dec(r.noteEnc), answers: r.extra,
      answerFields: Object.keys(spec.answers), consentTextVersion: r.consentTextVersion, consentAt: r.consentAt, sourceEnv: r.sourceEnv, lostReason: r.lostReason,
      duplicates: dups, events: events.map((e) => ({ id: e.id, kind: e.kind, actor: e.actor, actorName: e.actorName, data: e.data, createdAt: e.createdAt })),
      allowedTransitions: LEAD_TRANSITIONS[r.status as LeadStatus] ?? [],
    };
  }

  private async ensureStaff(u: AuthUser) {
    if (!u.roles?.some((r) => OPS_ROLES.includes(r))) return;
    await this.prisma.opsStaffContact.upsert({
      where: { sub: u.sub },
      create: { sub: u.sub, name: u.name ?? null, phone: u.phone ?? null, email: u.email ?? null, roles: u.roles.filter((r) => OPS_ROLES.includes(r)), locale: u.locale === 'ar' ? 'ar' : 'en' },
      update: { name: u.name ?? undefined, lastSeenAt: new Date() },
    }).catch(() => undefined);
  }

  async owners(u: AuthUser) {
    await this.ensureStaff(u);
    const rows = await this.prisma.opsStaffContact.findMany({ where: { lastSeenAt: { gte: new Date(Date.now() - 90 * 86_400_000) } }, orderBy: [{ name: 'asc' }, { sub: 'asc' }], take: 100 });
    return rows.map((r) => ({ sub: r.sub, name: r.name ?? r.sub, roles: r.roles }));
  }

  async update(u: AuthUser, id: string, b: { status?: string; lostReason?: string | null; ownerSub?: string | null; isTest?: boolean; addTags?: string[]; removeTags?: string[] }) {
    const r = await this.row(id); const conf = await this.config.current();
    const data: Record<string, unknown> = {}; const events: Array<{ kind: string; data: Record<string, unknown> }> = [];
    if (b.status !== undefined && b.status !== r.status) {
      if (!(LEAD_STATUSES as readonly string[]).includes(b.status)) throw badRequest('INVALID_STATUS', 'Unknown status');
      if (!LEAD_TRANSITIONS[r.status as LeadStatus]?.includes(b.status as LeadStatus)) throw conflict('INVALID_TRANSITION', `A request that is ${r.status} cannot become ${b.status}`, { from: r.status, to: b.status, allowed: LEAD_TRANSITIONS[r.status as LeadStatus] });
      data.status = b.status;
      if (b.status === 'LOST') {
        if (b.lostReason && !conf.lostReasons.some((x) => x.key === b.lostReason)) throw badRequest('INVALID_LOST_REASON', 'Unknown lost reason');
        data.lostReason = b.lostReason ?? null;
      } else data.lostReason = null;
      events.push({ kind: 'STATUS', data: { from: r.status, to: b.status, ...(b.status === 'LOST' && b.lostReason ? { reason: b.lostReason } : {}) } });
    }
    if (b.ownerSub !== undefined && (b.ownerSub ?? null) !== r.ownerSub) {
      if (b.ownerSub === null || b.ownerSub === '') { data.ownerSub = null; data.ownerName = null; events.push({ kind: 'ASSIGN', data: { from: r.ownerSub, to: null } }); }
      else {
        const s = await this.prisma.opsStaffContact.findUnique({ where: { sub: b.ownerSub } });
        if (!s) throw badRequest('OWNER_NOT_FOUND', 'That team member is not known to the console yet');
        data.ownerSub = s.sub; data.ownerName = (s.name ?? s.sub).slice(0, 80);
        events.push({ kind: 'ASSIGN', data: { from: r.ownerSub, to: s.sub, toName: data.ownerName } });
      }
    }
    if (b.isTest !== undefined && b.isTest !== r.isTest) {
      if (!u.roles.includes('super_admin')) throw new ApiError(403, 'SUPER_ADMIN_ONLY', 'Only a super admin can change the test tag');
      data.isTest = b.isTest; events.push({ kind: 'TAG', data: { test: b.isTest } });
    }
    const clean = (xs?: string[]) => (xs ?? []).map((x) => String(x).trim().toLowerCase()).filter((x) => /^[a-z0-9][a-z0-9_-]{0,23}$/.test(x));
    if (b.addTags || b.removeTags || data.isTest !== undefined) {
      let tags = new Set(r.tags);
      for (const t of clean(b.addTags)) tags.add(t); for (const t of clean(b.removeTags)) tags.delete(t);
      if (data.isTest === true) tags.add('test'); if (data.isTest === false) tags.delete('test');
      tags = new Set([...tags].slice(0, 12));
      if (JSON.stringify([...tags].sort()) !== JSON.stringify([...r.tags].sort())) { data.tags = [...tags]; if (b.addTags || b.removeTags) events.push({ kind: 'TAG', data: { add: clean(b.addTags), remove: clean(b.removeTags) } }); }
    }
    if (Object.keys(data).length) {
      await this.prisma.lead.update({ where: { id }, data: data as never });
      for (const e of events) await this.prisma.leadEvent.create({ data: { id: newId('le'), leadId: id, kind: e.kind, actor: u.sub, actorName: u.name ?? null, data: e.data as never } });
      await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'lead.updated', resource: 'Lead', resourceId: id, metadata: { kinds: events.map((e) => e.kind), status: data.status } as never } });
    }
    return this.detail(u, id);
  }

  async addNote(u: AuthUser, id: string, text: string) {
    await this.row(id); const t = (text ?? '').trim();
    // eslint-disable-next-line no-control-regex
    if (!t || t.length > 1000 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/.test(t)) throw badRequest('INVALID_NOTE', 'A note is 1 to 1000 characters', { field: 'text' });
    await this.prisma.leadEvent.create({ data: { id: newId('le'), leadId: id, kind: 'NOTE', actor: u.sub, actorName: u.name ?? null, data: { text: t } as never } });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'lead.note_added', resource: 'Lead', resourceId: id } });
    return this.detail(u, id);
  }

  async exportCsv(u: AuthUser, f: Filters) {
    const rows = await this.prisma.lead.findMany({ where: this.where(f) as never, orderBy: { createdAt: 'desc' }, take: MAX_EXPORT + 1 });
    const truncated = rows.length > MAX_EXPORT; const list = rows.slice(0, MAX_EXPORT);
    const headers = ['reference', 'created_at', 'status', 'mode', 'provider_type', 'legal_name', 'trade_name', 'contact_name', 'contact_role', 'phone', 'email', 'market', 'governorate', 'city', 'branches', 'staff_count', 'specialties', 'services', 'current_software', 'facility_licence', 'professional_licence', 'commercial_register', 'tax_card', 'modules', 'go_live', 'language', 'contact_channel', 'contact_time', 'note', 'owner', 'tags', 'test', 'duplicate_of', 'answers'];
    const body = list.map((r) => { const l = this.licences(r); return [r.ref, r.createdAt, r.status, r.mode, r.providerType, r.legalName, r.tradeName, this.dec(r.contactNameEnc), r.contactRole, this.dec(r.phoneEnc), this.dec(r.emailEnc), r.market, r.governorate, r.city, r.branches, r.staffCount, r.specialties, r.services, r.currentSoftware, ...LICENCE_FIELDS.map((k) => l[k]), r.modules, r.goLive, r.locale, r.contactChannel, r.contactTime, this.dec(r.noteEnc), r.ownerName, r.tags, r.isTest, r.duplicateOfId, JSON.stringify(r.extra)]; });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'lead.exported', resource: 'Lead', metadata: { rows: list.length, truncated, filters: Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== 'q')) } as never } });
    return { csv: toCsv(headers, body), rows: list.length, truncated };
  }

  /** Super admin: remove the leads tagged as test data. Dry run unless `confirm`. Events cascade. Returns the count. */
  async removeTestLeads(u: AuthUser, confirm: boolean) {
    const n = await this.prisma.lead.count({ where: { isTest: true } });
    if (!confirm) return { dryRun: true, count: n };
    const r = await this.prisma.lead.deleteMany({ where: { isTest: true } });
    await this.prisma.auditLog.create({ data: { actor: u.sub, action: 'lead.test_removed', resource: 'Lead', metadata: { count: r.count } as never } });
    return { dryRun: false, count: r.count };
  }

  async adminConfig() { const g = await this.config.get(); return { version: g.version, updatedAt: g.updatedAt, updatedBy: g.updatedBy, isDefault: g.isDefault, config: g.config, requirable: REQUIRABLE_FIELDS, typeFields: TYPE_FIELDS, transitions: LEAD_TRANSITIONS }; }
  async saveConfig(u: AuthUser, body: { version?: number; config?: unknown }) {
    if (typeof body.version !== 'number') throw badRequest('VERSION_REQUIRED', 'Send the version you loaded');
    await this.config.save(u.sub, body.config, body.version);
    return this.adminConfig();
  }
}

export type { LeadConfig, ParsedLead };
