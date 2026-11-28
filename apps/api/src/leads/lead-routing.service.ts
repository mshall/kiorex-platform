import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { cfg } from '../common/config';
import { badRequest, conflict } from '../common/errors';
import { newId } from '../common/ids';
import { marketZone } from '../common/market-time';
import { PrismaService } from '../prisma/prisma.service';
import { LeadNotifier } from './lead-notifier';
import { DEFAULT_ROUTING_CONFIG, ROUTING_ROLES, nextInRotation, slaOf, validateRoutingConfig, type RoutingConfig, type Sla } from './lead-routing';

const KEY = 'routing';
const STATE_KEY = 'roundrobin';
const TTL_MS = 15_000;
type LeadRow = NonNullable<Awaited<ReturnType<PrismaService['lead']['findUnique']>>>;

/**
 * Round-robin owner of new join requests and the reminder clock of requests that stay NEW (founder decision 28 Nov 2026).
 *  - Settings: one versioned document (`LeadSetting` "routing"), saved by a super admin only, audited (`lead.routing_changed`), no second approver by design (no money, legal or safety effect).
 *  - Round-robin: persistent pointer in `LeadRoutingState`, advanced under a row lock, so two simultaneous requests never share a turn. Inactive users are skipped; nobody eligible = the request stays
 *    unassigned with the visible flag NO_ELIGIBLE_OWNER. A human assignment always wins and clears the flag.
 *  - Reminders: a NEW request with no human touch (status change, note, owner change) is reminded to its owner after N working hours and escalated to the super admins after M working hours.
 *    Each stage is claimed with one atomic conditional update (`remindedAt` / `escalatedAt`), so a restart, two instances or a retry never send twice. A touch resets both stamps.
 * Ids and counts only in logs; message bodies carry the reference and the type, never contact details.
 */
@Injectable()
export class LeadRoutingService implements OnModuleInit, OnModuleDestroy {
  private readonly log = new Logger('lead-routing');
  private timer?: NodeJS.Timeout;
  private cache?: { at: number; config: RoutingConfig };
  constructor(private readonly prisma: PrismaService, private readonly notifier: LeadNotifier) {}

  onModuleInit() {
    if (!cfg().jobsEnabled) return;
    const sec = Math.max(10, Number(process.env.LEAD_SLA_TICK_SECONDS) || 300);
    this.timer = setInterval(() => void this.sweep().catch((e) => this.log.warn(`sla sweep failed: ${(e as Error).message}`)), sec * 1000); this.timer.unref();
  }
  onModuleDestroy() { if (this.timer) clearInterval(this.timer); }

  clock() { return { zone: marketZone(), fallbackMinutes: cfg().tzOffsetHours * 60 }; }

  // ───────────────────────── settings ─────────────────────────

  async get(): Promise<{ version: number; config: RoutingConfig; updatedAt: Date | null; updatedBy: string | null; isDefault: boolean }> {
    const row = await this.prisma.leadSetting.findUnique({ where: { key: KEY } });
    if (!row) return { version: 0, config: DEFAULT_ROUTING_CONFIG, updatedAt: null, updatedBy: null, isDefault: true };
    const v = validateRoutingConfig(row.value);
    return { version: row.version, config: v.ok ? v.config : DEFAULT_ROUTING_CONFIG, updatedAt: row.updatedAt, updatedBy: row.updatedBy, isDefault: !v.ok };
  }
  async current(): Promise<RoutingConfig> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.config;
    const g = await this.get(); this.cache = { at: Date.now(), config: g.config }; return g.config;
  }
  invalidate() { this.cache = undefined; }

  /** Super admin only (the controller enforces it). Optimistic concurrency on `expectedVersion`; the audit line names the changed sections and counts, never a user list. */
  async save(actor: string, raw: unknown, expectedVersion: number) {
    const v = validateRoutingConfig(raw);
    if (!v.ok) throw badRequest('INVALID_ROUTING_CONFIG', 'The routing settings are not valid', { errors: v.errors });
    const cur = await this.get();
    if (cur.version !== expectedVersion) throw conflict('ROUTING_CONFIG_STALE', 'The settings changed since you opened them: reload and try again', { version: cur.version });
    const changed = (Object.keys(v.config) as (keyof RoutingConfig)[]).filter((k) => JSON.stringify(v.config[k]) !== JSON.stringify(cur.config[k]));
    const next = cur.version + 1;
    if (cur.version === 0) await this.prisma.leadSetting.create({ data: { key: KEY, value: v.config as never, version: next, updatedBy: actor } });
    else {
      const r = await this.prisma.leadSetting.updateMany({ where: { key: KEY, version: cur.version }, data: { value: v.config as never, version: next, updatedBy: actor } });
      if (!r.count) throw conflict('ROUTING_CONFIG_STALE', 'The settings changed since you opened them: reload and try again');
    }
    await this.prisma.auditLog.create({ data: { actor, action: 'lead.routing_changed', resource: 'LeadSetting', resourceId: KEY, metadata: { version: next, sections: changed, roundRobin: v.config.roundRobin.enabled, eligibleCount: v.config.roundRobin.eligibleSubs.length, reminders: v.config.reminders.enabled } as never } });
    this.invalidate();
    return this.view();
  }

  /** Settings, the console users who could own requests (with the reason someone is not eligible) and the state of the rotation. */
  async view() {
    const g = await this.get();
    const [staff, state] = await Promise.all([
      this.prisma.opsStaffContact.findMany({ where: { roles: { hasSome: [...ROUTING_ROLES] } }, orderBy: [{ name: 'asc' }, { sub: 'asc' }], take: 200 }),
      this.prisma.leadRoutingState.findUnique({ where: { key: STATE_KEY } }),
    ]);
    const since = Date.now() - g.config.roundRobin.activeWithinDays * 86_400_000;
    const list = g.config.roundRobin.eligibleSubs;
    return {
      version: g.version, updatedAt: g.updatedAt, updatedBy: g.updatedBy, isDefault: g.isDefault, config: g.config,
      candidates: staff.map((s) => ({ sub: s.sub, name: s.name ?? s.sub, roles: s.roles.filter((r) => ROUTING_ROLES.includes(r)), active: s.lastSeenAt.getTime() >= since, listed: list.includes(s.sub), eligibleNow: s.lastSeenAt.getTime() >= since && (!list.length || list.includes(s.sub)), lastSeenAt: s.lastSeenAt })),
      state: { lastSub: state?.lastSub ?? null, assignedCount: state?.assignedCount ?? 0, updatedAt: state?.updatedAt ?? null },
      workTimeZone: marketZone(),
    };
  }

  // ───────────────────────── round-robin ─────────────────────────

  private async eligibleSubs(c: RoutingConfig): Promise<string[]> {
    const rows = await this.prisma.opsStaffContact.findMany({
      where: { roles: { hasSome: [...ROUTING_ROLES] }, lastSeenAt: { gte: new Date(Date.now() - c.roundRobin.activeWithinDays * 86_400_000) }, ...(c.roundRobin.eligibleSubs.length ? { sub: { in: c.roundRobin.eligibleSubs } } : {}) },
      select: { sub: true },
    });
    return rows.map((r) => r.sub);
  }

  /**
   * Gives a brand-new, unassigned request to the next eligible console user. Never throws (the applicant's request is already stored). Test requests are not routed (they would skew the
   * rotation). A concurrent human assignment wins: the owner is only written while it is still empty.
   */
  async assignNew(leadId: string): Promise<{ assigned: string | null; flagged: boolean }> {
    try {
      const c = await this.current();
      if (!c.roundRobin.enabled) return { assigned: null, flagged: false };
      const lead = await this.prisma.lead.findUnique({ where: { id: leadId }, select: { id: true, ownerSub: true, isTest: true } });
      if (!lead || lead.ownerSub || lead.isTest) return { assigned: null, flagged: false };
      const eligible = await this.eligibleSubs(c);
      const out = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`INSERT INTO "LeadRoutingState" ("key", "updatedAt") VALUES (${STATE_KEY}, now()) ON CONFLICT ("key") DO NOTHING`;
        const [st] = await tx.$queryRaw<{ lastSub: string | null }[]>`SELECT "lastSub" FROM "LeadRoutingState" WHERE "key" = ${STATE_KEY} FOR UPDATE`;
        const pick = nextInRotation(eligible, st?.lastSub);
        if (!pick) {
          const f = await tx.lead.updateMany({ where: { id: leadId, ownerSub: null }, data: { routingFlag: 'NO_ELIGIBLE_OWNER' } });
          return { pick: null as string | null, name: null as string | null, flagged: f.count === 1 };
        }
        const staff = await tx.opsStaffContact.findUnique({ where: { sub: pick }, select: { name: true } });
        const name = (staff?.name ?? pick).slice(0, 80);
        const u = await tx.lead.updateMany({ where: { id: leadId, ownerSub: null }, data: { ownerSub: pick, ownerName: name, assignedVia: 'ROUND_ROBIN', routingFlag: null } });
        if (u.count !== 1) return { pick: null, name: null, flagged: false }; // a person assigned it first: the turn is not used
        await tx.leadRoutingState.update({ where: { key: STATE_KEY }, data: { lastSub: pick, assignedCount: { increment: 1 } } });
        return { pick, name, flagged: false };
      }, { timeout: 10_000 });
      if (out.pick) {
        await this.prisma.leadEvent.create({ data: { id: newId('le'), leadId, kind: 'ASSIGN', actor: 'system:round-robin', actorName: null, data: { from: null, to: out.pick, toName: out.name, via: 'ROUND_ROBIN' } as never } });
        await this.prisma.auditLog.create({ data: { actor: 'system:round-robin', action: 'lead.auto_assigned', resource: 'Lead', resourceId: leadId, metadata: { to: out.pick } as never } });
        this.log.log(`lead ${leadId} assigned round-robin to ${out.pick}`);
      } else if (out.flagged) {
        await this.prisma.leadEvent.create({ data: { id: newId('le'), leadId, kind: 'ROUTING', actor: 'system:round-robin', actorName: null, data: { action: 'NO_ELIGIBLE_OWNER' } as never } });
        await this.prisma.auditLog.create({ data: { actor: 'system:round-robin', action: 'lead.no_eligible_owner', resource: 'Lead', resourceId: leadId } });
        this.log.warn(`lead ${leadId}: no eligible owner, left unassigned and flagged`);
      }
      return { assigned: out.pick, flagged: out.flagged };
    } catch (e) { this.log.warn(`round-robin failed lead=${leadId}: ${(e as Error).message}`); return { assigned: null, flagged: false }; }
  }

  // ───────────────────────── reminder clock ─────────────────────────

  async slaFor(l: Pick<LeadRow, 'status' | 'createdAt' | 'lastTouchedAt'>, now = new Date()): Promise<Sla> { return slaOf(l, await this.current(), now, this.clock()); }
  slaWith(c: RoutingConfig, l: Pick<LeadRow, 'status' | 'createdAt' | 'lastTouchedAt'>, now = new Date()): Sla { return slaOf(l, c, now, this.clock()); }

  /** Counts for the console badge: requests still NEW whose reminder, or escalation, is due. Test requests are excluded. `mine` = the caller's own. */
  async counts(sub?: string, now = new Date()) {
    const c = await this.current();
    if (!c.reminders.enabled) return { enabled: false, untouched: 0, remind: 0, escalated: 0, mineDue: 0, noEligible: 0 };
    const rows = await this.prisma.lead.findMany({ where: { status: 'NEW', isTest: false }, select: { status: true, createdAt: true, lastTouchedAt: true, ownerSub: true }, take: 2000 });
    let remind = 0; let escalated = 0; let mineDue = 0;
    for (const r of rows) { const s = this.slaWith(c, r, now).state; if (s === 'REMIND') remind++; if (s === 'ESCALATED') escalated++; if (sub && r.ownerSub === sub && (s === 'REMIND' || s === 'ESCALATED')) mineDue++; }
    const noEligible = await this.prisma.lead.count({ where: { isTest: false, routingFlag: 'NO_ELIGIBLE_OWNER', ownerSub: null, status: { in: ['NEW', 'CONTACTED', 'QUALIFIED'] } } });
    return { enabled: true, untouched: rows.length, remind, escalated, mineDue, noEligible };
  }

  private async recipients(where: Record<string, unknown>) {
    return this.prisma.opsStaffContact.findMany({ where: { leadAlerts: true, email: { not: null }, channels: { has: 'EMAIL' }, lastSeenAt: { gte: new Date(Date.now() - 90 * 86_400_000) }, ...where }, take: 30 });
  }

  /** One pass of the reminder job. Idempotent: every stage is claimed by one conditional update, so running it twice (or on two instances) sends once. */
  async sweep(now = new Date()): Promise<{ reminded: number; escalated: number }> {
    const c = await this.current();
    if (!c.reminders.enabled) return { reminded: 0, escalated: 0 };
    const rows = await this.prisma.lead.findMany({ where: { status: 'NEW', isTest: false, OR: [{ remindedAt: null }, { escalatedAt: null }] }, orderBy: { createdAt: 'asc' }, take: 500 });
    let reminded = 0; let escalated = 0;
    for (const r of rows) {
      const sla = this.slaWith(c, r, now);
      if (sla.state === 'OK' || sla.state === 'OFF') continue;
      const notice = { leadId: r.id, ref: r.ref, providerType: r.providerType, mode: r.mode, since: sla.since };
      if (!r.remindedAt) {
        const claim = await this.prisma.lead.updateMany({ where: { id: r.id, status: 'NEW', remindedAt: null, lastTouchedAt: r.lastTouchedAt }, data: { remindedAt: now } });
        if (claim.count === 1) {
          reminded++;
          const owner = r.ownerSub ? await this.recipients({ sub: r.ownerSub }) : [];
          const to = r.ownerSub ? owner : await this.recipients({ roles: { has: 'super_admin' } }); // nobody owns it: the super admins are told instead
          await this.notifier.onLeadReminder({ ...notice, level: 'REMIND', target: r.ownerSub ? 'owner' : 'super_admins_unassigned' }, to);
        }
      }
      if (sla.state === 'ESCALATED' && !r.escalatedAt) {
        const claim = await this.prisma.lead.updateMany({ where: { id: r.id, status: 'NEW', escalatedAt: null, lastTouchedAt: r.lastTouchedAt }, data: { escalatedAt: now, remindedAt: r.remindedAt ?? now } });
        if (claim.count === 1) { escalated++; await this.notifier.onLeadReminder({ ...notice, level: 'ESCALATE', target: 'super_admins' }, await this.recipients({ roles: { has: 'super_admin' } })); }
      }
    }
    if (reminded || escalated) this.log.log(`lead sla sweep reminded=${reminded} escalated=${escalated}`);
    return { reminded, escalated };
  }
}
