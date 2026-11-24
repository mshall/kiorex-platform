import { Injectable } from '@nestjs/common';
import { PARTNER_API_PATH } from '@kiorex/contracts';
import { cfg } from '../common/config';
import { decryptField, encryptField } from '../common/crypto';
import { badRequest, notFound, unavailable } from '../common/errors';
import { PartnerConn } from '../common/partner-http';
import { PrismaService } from '../prisma/prisma.service';

export type PartnerKind = 'PHARMACY' | 'LAB' | 'LAB_NURSE';
export interface PartnerInput { labRegistrationId?: string; name?: string; baseUrl?: string; clientKey?: string; clientSecret?: string; webhookSecret?: string; active?: boolean }

const PATH: Record<PartnerKind, string> = { PHARMACY: PARTNER_API_PATH.pharmacy, LAB: PARTNER_API_PATH.lab, LAB_NURSE: PARTNER_API_PATH.lab };
const KIND = (k: string): PartnerKind => { const u = k.toUpperCase().replace('-', '_'); if (u !== 'PHARMACY' && u !== 'LAB' && u !== 'LAB_NURSE') throw badRequest('INVALID_PARTNER_KIND', 'kind must be pharmacy, lab or lab_nurse'); return u; };

/**
 * Partner registry (kiorex-contracts 1.4.0): base URL host + HMAC client credentials + webhook secret PER PARTNER RECORD, ops-editable.
 * Resolution (per-registration routing): a call that names a registration id goes to THAT registration (even if it was paused since: in-flight orders must still be
 * cancelled/settled); a call without one (legacy rows, tooling) uses the first active registration of the kind; with none, the env defaults (dev PARTNER_DEV_DEFAULTS).
 * Pharmacy orders, carts and lab bookings carry `registrationId`, so several live partners of one kind each receive only their own traffic.
 * Secrets are encrypted at rest and never returned by the API (masked).
 */
@Injectable()
export class PartnerRegistry {
  constructor(private readonly prisma: PrismaService) {}

  private envConn(kind: PartnerKind) {
    const c = cfg();
    if (kind === 'PHARMACY') return { baseUrl: c.pharmacyBaseUrl, clientKey: c.pharmacyClientKey, clientSecret: c.pharmacyClientSecret, webhookSecret: c.pharmacyWebhookSecret };
    // LAB_NURSE: outbound only. The lab signs every webhook with its KIOREX_BOOKING client, so no separate webhook secret exists.
    if (kind === 'LAB_NURSE') return { baseUrl: c.labBaseUrl, clientKey: c.labNurseClientKey, clientSecret: c.labNurseClientSecret, webhookSecret: '' };
    return { baseUrl: c.labBaseUrl, clientKey: c.labClientKey, clientSecret: c.labClientSecret, webhookSecret: c.labWebhookSecret };
  }

  /** Connection for outbound calls (path prefix included). `registrationId` pins the registration that owns the order / booking / cart. */
  async conn(kind: PartnerKind, registrationId?: string | null): Promise<PartnerConn> {
    let reg;
    if (registrationId) {
      reg = await this.prisma.partnerRegistration.findUnique({ where: { id: registrationId } });
      if (!reg || reg.kind !== kind) throw unavailable('PARTNER_REGISTRATION_MISSING', 'The partner that owns this request is no longer registered', { retryable: false });
    } else reg = await this.prisma.partnerRegistration.findFirst({ where: { kind, active: true }, orderBy: { createdAt: 'asc' } });
    const c = reg ? { baseUrl: reg.baseUrl, clientKey: reg.clientKey, clientSecret: decryptField(reg.clientSecretEnc) } : this.envConn(kind);
    return { baseUrl: `${c.baseUrl.replace(/\/+$/, '')}${PATH[kind]}`, clientKey: c.clientKey, clientSecret: c.clientSecret, timeoutMs: cfg().partnerTimeoutMs };
  }

  /**
   * Webhook secret for an inbound partner event. `clientKey` (X-Kiorly-Client-Key) selects the registration; unknown key => null (401).
   * Without the header only the env secret is accepted, and never in production (a registered key is mandatory there).
   */
  async webhookSecret(kind: PartnerKind, clientKey: string | undefined): Promise<string | null> { return (await this.webhookAuth(kind, clientKey))?.secret ?? null; }

  /** Same as webhookSecret, plus WHICH registration the key selected (null = env default): the receiver binds the event to that registration's own orders. */
  async webhookAuth(kind: PartnerKind, clientKey: string | undefined): Promise<{ secret: string; registrationId: string | null } | null> {
    if (clientKey) {
      const reg = await this.prisma.partnerRegistration.findFirst({ where: { kind, clientKey, active: true } });
      if (reg) return { secret: decryptField(reg.webhookSecretEnc), registrationId: reg.id };
      const e = this.envConn(kind);
      return !cfg().isProd && e.clientKey === clientKey && e.webhookSecret ? { secret: e.webhookSecret, registrationId: null } : null;
    }
    return cfg().isProd || !this.envConn(kind).webhookSecret ? null : { secret: this.envConn(kind).webhookSecret, registrationId: null };
  }

  /** Active registrations of a kind, oldest first (the order the legacy "first active" rule used). */
  async activeRegistrations(kind: PartnerKind) { return this.prisma.partnerRegistration.findMany({ where: { kind, active: true }, orderBy: { createdAt: 'asc' }, select: { id: true, kind: true, name: true, clientKey: true, labRegistrationId: true } }); }
  async registration(id: string | null | undefined) { return id ? this.prisma.partnerRegistration.findUnique({ where: { id }, select: { id: true, kind: true, name: true, clientKey: true, active: true } }) : null; }
  /** The partner's own organisation id (PartnerConnection.orgRef) behind a registration: org-scope flags and policy overrides are keyed by it. Null for dev/env registrations. */
  async orgRefOf(registrationId: string | null | undefined): Promise<string | null> {
    if (!registrationId) return null;
    return (await this.prisma.partnerConnection.findFirst({ where: { registrationId }, select: { orgRef: true } }))?.orgRef ?? null;
  }

  private present(r: { labRegistrationId?: string | null; id: string; kind: string; name: string; baseUrl: string; clientKey: string; active: boolean; createdAt: Date; updatedAt: Date }) {
    return { id: r.id, kind: r.kind.toLowerCase(), name: r.name, baseUrl: r.baseUrl, clientKey: r.clientKey, clientSecret: '********', webhookSecret: '********', active: r.active, apiPath: PATH[r.kind as PartnerKind], labRegistrationId: r.labRegistrationId ?? null, createdAt: r.createdAt.toISOString(), updatedAt: r.updatedAt.toISOString() };
  }
  async list() { return (await this.prisma.partnerRegistration.findMany({ orderBy: [{ kind: 'asc' }, { createdAt: 'asc' }] })).map((r) => this.present(r)); }

  /** Create or update (by id). A new registration needs every field; an update may change any subset (secrets only when provided). */
  async upsert(kindRaw: string, id: string | undefined, i: PartnerInput) {
    const kind = KIND(kindRaw);
    if (i.baseUrl !== undefined && !/^https?:\/\/[^/\s]+$/.test(i.baseUrl.replace(/\/+$/, ''))) throw badRequest('INVALID_BASE_URL', 'baseUrl must be a host URL without a path, e.g. http://localhost:3100');
    if (id) {
      const cur = await this.prisma.partnerRegistration.findUnique({ where: { id } });
      if (!cur || cur.kind !== kind) throw notFound('PARTNER_NOT_FOUND', 'Partner registration not found');
      return this.present(await this.prisma.partnerRegistration.update({ where: { id }, data: { name: i.name, baseUrl: i.baseUrl?.replace(/\/+$/, ''), clientKey: i.clientKey, ...(i.labRegistrationId !== undefined && kind === 'LAB_NURSE' ? { labRegistrationId: i.labRegistrationId || null } : {}), ...(i.clientSecret ? { clientSecretEnc: encryptField(i.clientSecret) } : {}), ...(i.webhookSecret ? { webhookSecretEnc: encryptField(i.webhookSecret) } : {}), active: i.active } }));
    }
    if (!i.name || !i.baseUrl || !i.clientKey || !i.clientSecret || (!i.webhookSecret && kind !== 'LAB_NURSE')) throw badRequest('PARTNER_INCOMPLETE', 'name, baseUrl, clientKey, clientSecret and webhookSecret are required (LAB_NURSE: webhookSecret is not used)');
    const r = await this.prisma.partnerRegistration.create({ data: { id: `pr_${kind.toLowerCase()}_${Math.random().toString(36).slice(2, 10)}`, kind, name: i.name, baseUrl: i.baseUrl.replace(/\/+$/, ''), clientKey: i.clientKey, clientSecretEnc: encryptField(i.clientSecret), webhookSecretEnc: encryptField(i.webhookSecret ?? ''), active: i.active ?? true, ...(kind === 'LAB_NURSE' && i.labRegistrationId ? { labRegistrationId: i.labRegistrationId } : {}) } });
    return this.present(r);
  }

  /** Idempotent dev registration from the env defaults (seed + tests). Refuses in production. */
  async seedDev(kindRaw: string) {
    if (cfg().isProd) throw badRequest('DEV_ONLY', 'dev partner registration is never created in production');
    const kind = KIND(kindRaw);
    const e = this.envConn(kind);
    const id = `pr_${kind.toLowerCase()}_dev`;
    const data = { kind, name: `Kiorly ${kind === 'PHARMACY' ? 'Pharmacy' : kind === 'LAB_NURSE' ? 'Lab (nurse source)' : 'Lab'} (dev)`, baseUrl: e.baseUrl.replace(/\/+$/, ''), clientKey: e.clientKey, clientSecretEnc: encryptField(e.clientSecret), webhookSecretEnc: encryptField(e.webhookSecret), active: true };
    const labRegistrationId = kind === 'LAB_NURSE' ? 'pr_lab_dev' : undefined; // the dev nurse client belongs to the dev lab tenant
    await this.prisma.partnerRegistration.upsert({ where: { id }, create: { id, ...data, ...(labRegistrationId ? { labRegistrationId } : {}) }, update: { ...data, ...(labRegistrationId ? { labRegistrationId } : {}) } });
  }
}
