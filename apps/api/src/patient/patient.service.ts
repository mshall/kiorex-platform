import { Inject, Injectable, OnModuleInit, Optional } from '@nestjs/common';
import { PatientProfile } from '../prisma/generated/client';
import { blindIndex, decryptField, encryptField } from '../common/crypto';
import { badRequest, forbidden, notFound } from '../common/errors';
import { AuthUser } from '../common/auth';
import { AuthSessionService } from '../auth/auth-public';
import { MarketService } from '../market/market-public';
import { OutboxService } from '../outbox/outbox-public';
import { GROWTH_FACTS, type GrowthFactsPort } from '../growth/growth-ports-public';
import { subRefOf } from '../common/privacy-hash';
import { PrismaService } from '../prisma/prisma.service';
import { ALL_CONSENT_PURPOSES, ConsentService, CORE_CONSENT_PURPOSES, type SetConsentOpts } from './consent/consent.service';

/** The Rev 2.2 consent centre list (unchanged shape). The growth purposes (ANALYTICS_MEASUREMENT, MARKETING_*) live in the preference centre and are also accepted by setConsent. */
export const CONSENT_PURPOSES = CORE_CONSENT_PURPOSES;
export type ConsentPurpose = (typeof CONSENT_PURPOSES)[number] | (typeof ALL_CONSENT_PURPOSES)[number];
/** NEEDS_HUMAN: consent copy/versions are legal wording; version is a placeholder until counsel signs off. */
export const CONSENT_VERSION = 'TODO_NEEDS_HUMAN_v0';

type Contributor = (sub: string) => Promise<unknown>;

export interface ProfileInput {
  nameEn?: string; nameAr?: string; dateOfBirth?: string; gender?: string; nationalId?: string | null; preferredLocale?: string; email?: string; phone?: string; market?: string;
}

const AGE_OF_MAJORITY = 18;

@Injectable()
export class PatientService implements OnModuleInit {
  private exporters = new Map<string, Contributor>();
  private anonymizers = new Map<string, Contributor>();
  constructor(private readonly prisma: PrismaService, private readonly sessions: AuthSessionService, private readonly outbox: OutboxService, private readonly markets: MarketService, private readonly consentSvc: ConsentService, @Optional() @Inject(GROWTH_FACTS) private readonly growthFacts?: GrowthFactsPort) {}

  onModuleInit() {
    this.outbox.register('subject.deleted', async (e) => {
      await this.performDeletion(e.payload.sub, { viaIdp: true });
    });
  }

  /** Other modules contribute to export/deletion (AC-06) without this module importing them. */
  registerExport(name: string, fn: Contributor) { this.exporters.set(name, fn); }
  registerAnonymizer(name: string, fn: Contributor) { this.anonymizers.set(name, fn); }

  // ── profile (KXM-AC-02) ──
  async ensureProfile(u: AuthUser): Promise<PatientProfile> {
    const existing = await this.prisma.patientProfile.findUnique({ where: { sub: u.sub } });
    if (existing) return existing;
    const created = await this.prisma.patientProfile.create({ data: { sub: u.sub, phone: u.phone, nameEn: u.name, preferredLocale: u.locale === 'en' ? 'en' : 'ar' } });
    // GRW-P1-J: PatientRegistered, once per person (keyed reference as the natural key, never the sub), best effort
    await this.growthFacts?.recordFact({ name: 'PatientRegistered', naturalKey: subRefOf(u.sub), props: {} }).catch(() => undefined);
    return created;
  }

  present(p: PatientProfile) {
    const nid = p.nationalIdEnc ? decryptField(p.nationalIdEnc) : null;
    return {
      id: p.id, sub: p.sub, phone: p.phone, email: p.email, nameEn: p.nameEn, nameAr: p.nameAr, dateOfBirth: p.dateOfBirth, gender: p.gender,
      hasNationalId: !!nid, nationalIdLast4: nid ? nid.slice(-4) : null, preferredLocale: p.preferredLocale, market: p.market, noShowCount: p.noShowCount, createdAt: p.createdAt,
    };
  }

  async getProfile(u: AuthUser) {
    return this.present(await this.ensureProfile(u));
  }

  async updateProfile(u: AuthUser, i: ProfileInput) {
    await this.ensureProfile(u);
    if (i.nationalId && !/^\d{14}$/.test(i.nationalId.trim())) throw badRequest('INVALID_NATIONAL_ID', 'National ID must be 14 digits');
    if (i.preferredLocale && !['ar', 'en'].includes(i.preferredLocale)) throw badRequest('INVALID_LOCALE', 'locale must be ar or en');
    if (i.market !== undefined) { await this.markets.assertLive(i.market.toUpperCase()); } // sign-up country must be a LIVE market
    const data: Record<string, unknown> = {};
    if (i.market) data.market = i.market.toUpperCase();
    for (const k of ['nameEn', 'nameAr', 'gender', 'preferredLocale', 'email', 'phone'] as const) if (i[k] !== undefined) data[k] = i[k];
    if (i.dateOfBirth !== undefined) data.dateOfBirth = i.dateOfBirth ? new Date(i.dateOfBirth) : null;
    if (i.nationalId !== undefined) {
      const v = i.nationalId?.trim();
      data.nationalIdEnc = v ? encryptField(v) : null; // encrypted at rest
      data.nationalIdHash = v ? blindIndex(v) : null;
    }
    return this.present(await this.prisma.patientProfile.update({ where: { sub: u.sub }, data }));
  }

  /** Identity payload for Kiorly booking; dependants book under the guardian's phone with their own name. */
  async bookingIdentity(sub: string, dependantId?: string) {
    const p = await this.prisma.patientProfile.findUnique({ where: { sub } });
    if (!p || p.deletedAt) throw notFound('PROFILE_NOT_FOUND', 'Complete your profile first');
    if (dependantId) {
      const d = await this.prisma.dependant.findFirst({ where: { id: dependantId, guardianSub: sub, deletedAt: null } });
      if (!d) throw forbidden('NOT_GUARDIAN', 'Not a guardian of this dependant');
      return { phone: p.phone ?? '', firstNameEn: d.nameEn.split(' ')[0], lastNameEn: d.nameEn.split(' ').slice(1).join(' ') || d.nameEn, gender: d.gender ?? undefined, nationalId: undefined, email: p.email ?? undefined, forDependant: true, locale: p.preferredLocale };
    }
    const parts = (p.nameEn ?? '').trim().split(/\s+/);
    if (!p.phone || !parts[0]) throw badRequest('PROFILE_INCOMPLETE', 'Name and phone are required to book');
    return { phone: p.phone, firstNameEn: parts[0], lastNameEn: parts.slice(1).join(' ') || parts[0], gender: p.gender ?? undefined, nationalId: p.nationalIdEnc ? decryptField(p.nationalIdEnc) : undefined, email: p.email ?? undefined, forDependant: false, locale: p.preferredLocale };
  }

  async profileBySub(sub: string) {
    return this.prisma.patientProfile.findUnique({ where: { sub } });
  }
  async incrementNoShow(sub: string) {
    await this.prisma.patientProfile.updateMany({ where: { sub }, data: { noShowCount: { increment: 1 } } });
  }

  // ── dependants (KXM-AC-03) ──
  async addDependant(u: AuthUser, i: { nameEn: string; nameAr?: string; dateOfBirth: string; gender?: string; relationship: string; evidence?: string }) {
    await this.ensureProfile(u);
    const dob = new Date(i.dateOfBirth);
    if (Number.isNaN(dob.getTime()) || dob > new Date()) throw badRequest('INVALID_DOB', 'Invalid date of birth');
    const expiresAt = new Date(dob);
    expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + AGE_OF_MAJORITY);
    if (expiresAt <= new Date()) throw badRequest('DEPENDANT_ADULT', 'Dependants must be under 18; adults create their own account (KA06)');
    return this.prisma.dependant.create({ data: { guardianSub: u.sub, nameEn: i.nameEn, nameAr: i.nameAr, dateOfBirth: dob, gender: i.gender, relationship: i.relationship, evidence: i.evidence, expiresAt } });
  }
  async listDependants(sub: string) {
    const rows = await this.prisma.dependant.findMany({ where: { guardianSub: sub, deletedAt: null }, orderBy: { createdAt: 'asc' } });
    return rows.map((d) => ({ ...d, guardianAccessExpired: !!d.expiresAt && d.expiresAt <= new Date() }));
  }
  async updateDependant(sub: string, id: string, i: { nameEn?: string; nameAr?: string; gender?: string; relationship?: string }) {
    const r = await this.prisma.dependant.updateMany({ where: { id, guardianSub: sub, deletedAt: null }, data: i });
    if (!r.count) throw notFound('DEPENDANT_NOT_FOUND', 'Dependant not found');
    return this.prisma.dependant.findUnique({ where: { id } });
  }
  async removeDependant(sub: string, id: string) {
    const r = await this.prisma.dependant.updateMany({ where: { id, guardianSub: sub, deletedAt: null }, data: { deletedAt: new Date() } });
    if (!r.count) throw notFound('DEPENDANT_NOT_FOUND', 'Dependant not found');
    return { ok: true };
  }
  /** Guardian access ends at age of majority. */
  async assertGuardian(sub: string, dependantId: string) {
    const d = await this.prisma.dependant.findFirst({ where: { id: dependantId, guardianSub: sub, deletedAt: null } });
    if (!d) throw forbidden('NOT_GUARDIAN', 'Not a guardian of this dependant');
    if (d.expiresAt && d.expiresAt <= new Date()) throw forbidden('GUARDIAN_ACCESS_EXPIRED', 'Dependant reached age of majority');
    return d;
  }

  // ── consent centre (KXM-AC-04) ──
  async consents(sub: string) {
    const rows = await this.prisma.consentRecord.findMany({ where: { sub }, orderBy: { createdAt: 'desc' } });
    return CONSENT_PURPOSES.map((purpose) => {
      const last = rows.find((r) => r.purpose === purpose);
      return { purpose, granted: last?.granted ?? false, version: last?.version ?? null, updatedAt: last?.createdAt ?? null };
    });
  }
  async consentHistory(sub: string) {
    return this.prisma.consentRecord.findMany({ where: { sub }, orderBy: { createdAt: 'desc' }, take: 200 });
  }
  /** Append-only audit row + PatientConsentUpdated event, same transaction (ConsentService). `source` stays accepted as a plain string for older callers. */
  async setConsent(sub: string, purpose: string, granted: boolean, source: string | SetConsentOpts = 'app') {
    return this.consentSvc.setConsent(sub, purpose, granted, typeof source === 'string' ? { source } : source);
  }
  async hasConsent(sub: string, purpose: ConsentPurpose): Promise<boolean> {
    return this.consentSvc.hasConsent(sub, purpose);
  }

  // ── Kiorly record link rule (KXM-AC-07) ──
  async linkKiorlyPatient(i: { sub: string; dependantId?: string; clinicId: string; kiorlyPatientId: string; evidence: 'PHONE' | 'NATIONAL_ID' | 'PHONE_AND_NATIONAL_ID' }) {
    const existing = await this.prisma.kiorlyPatientLink.findMany({ where: { sub: i.sub, clinicId: i.clinicId, dependantId: i.dependantId ?? null } });
    if (existing.some((l) => l.kiorlyPatientId === i.kiorlyPatientId)) return existing.find((l) => l.kiorlyPatientId === i.kiorlyPatientId)!;
    // Never auto-merge: a different Kiorly patient for the same Kiorex subject+clinic is parked for human review.
    const status = existing.length ? 'CONFLICT_REVIEW' : 'LINKED';
    return this.prisma.kiorlyPatientLink.create({ data: { sub: i.sub, dependantId: i.dependantId, clinicId: i.clinicId, kiorlyPatientId: i.kiorlyPatientId, evidence: i.evidence, status } });
  }
  async recordIdentityConflict(sub: string, clinicId: string, detail: string) {
    return this.prisma.kiorlyPatientLink.create({ data: { sub, clinicId, kiorlyPatientId: `conflict:${Date.now()}`, evidence: detail.slice(0, 40), status: 'CONFLICT_REVIEW' } });
  }
  links(sub: string) {
    return this.prisma.kiorlyPatientLink.findMany({ where: { sub }, orderBy: { createdAt: 'desc' } });
  }

  // ── export & deletion (KXM-AC-06) ──
  async buildExport(sub: string) {
    const p = await this.prisma.patientProfile.findUnique({ where: { sub } });
    const out: Record<string, unknown> = {
      generatedAt: new Date().toISOString(),
      profile: p ? { ...this.present(p), nationalId: p.nationalIdEnc ? decryptField(p.nationalIdEnc) : null } : null,
      dependants: await this.prisma.dependant.findMany({ where: { guardianSub: sub } }),
      consents: await this.consentHistory(sub),
      kiorlyLinks: await this.links(sub),
    };
    for (const [name, fn] of this.exporters) out[name] = await fn(sub);
    return out;
  }

  async requestExport(sub: string) {
    const result = await this.buildExport(sub);
    const r = await this.prisma.dataRequest.create({ data: { sub, kind: 'EXPORT', status: 'COMPLETED', result: result as any, completedAt: new Date() } });
    return { id: r.id, ...result };
  }

  async requestDeletion(sub: string, opts: { includeExport?: boolean }) {
    const exportData = opts.includeExport ? await this.buildExport(sub) : undefined;
    await this.performDeletion(sub, { viaIdp: false });
    return { ok: true, deleted: true, ...(exportData ? { export: exportData } : {}), note: 'Legally required booking/payment records are retained without personal identifiers' };
  }

  private async performDeletion(sub: string, _o: { viaIdp: boolean }) {
    const req = await this.prisma.dataRequest.create({ data: { sub, kind: 'DELETION' } });
    for (const fn of this.anonymizers.values()) await fn(sub);
    await this.prisma.$transaction([
      this.prisma.patientProfile.updateMany({ where: { sub }, data: { phone: null, email: null, nameEn: null, nameAr: null, dateOfBirth: null, gender: null, nationalIdEnc: null, nationalIdHash: null, deletedAt: new Date() } }),
      this.prisma.dependant.updateMany({ where: { guardianSub: sub }, data: { nameEn: 'deleted', nameAr: null, deletedAt: new Date() } }),
      this.prisma.kiorlyPatientLink.deleteMany({ where: { sub } }),
      this.prisma.dataRequest.update({ where: { id: req.id }, data: { status: 'COMPLETED', completedAt: new Date() } }),
    ]);
    await this.sessions.revokeAllForSub(sub);
  }
}
