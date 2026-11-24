import { randomBytes } from 'node:crypto';
import { GrowthConfigService } from '../src/growth/growth-public';
import { TestCtx } from './harness';

export const SUPER_A = { sub: 'adm_a', roles: ['super_admin', 'ops_admin'] };
export const SUPER_B = { sub: 'adm_b', roles: ['super_admin', 'ops_admin'] };

/** Gate evidence for the launch-locked visitor-key and marketing flags: a TEST FIXTURE (DEV-prefixed gate id), never a real counsel gate. */
export async function unlockFlag(c: TestCtx, key: 'growth.analytics_visitor' | 'growth.marketing_messaging' | 'growth.patient_referral' | 'growth.rewards' | 'growth.patient_credit' | 'growth.refund_as_credit' | 'growth.family_credit' | 'growth.support_goodwill') {
  await c.prisma.flagGateEvidence.upsert({ where: { flagKey_gateId: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE' } }, create: { flagKey: key, gateId: 'DEV-TEST-FIXTURE-NOT-A-REAL-GATE', approver: 'test fixture', approvedOn: new Date(), documentUrl: 'https://dev.invalid/fixture', recordedBy: 'TEST_FIXTURE' }, update: {} });
  c.flags.invalidate();
}

let n = 0;
export async function seedBooking(c: TestCtx, o: Partial<{ id: string; sub: string; tenantId: string | null; channel: string; createdAt: Date; providerId: string }> = {}) {
  const id = o.id ?? `kx_bk_t${Date.now().toString(36)}${(++n).toString(36)}${randomBytes(3).toString('hex')}`;
  const createdAt = o.createdAt ?? new Date();
  return c.prisma.bookingIntent.create({
    data: { id, sub: o.sub ?? 'sub_amira', providerId: o.providerId ?? 'lst_1', clinicId: 'cl_1', clinicianId: 'dr_1', tenantId: o.tenantId === undefined ? 'org_A' : o.tenantId, typeId: 'typ_1', startsAt: new Date(createdAt.getTime() + 86_400_000), endsAt: new Date(createdAt.getTime() + 86_400_000 + 1_800_000), status: 'CONFIRMED', channel: o.channel ?? 'MARKETPLACE', createdAt },
  });
}

/** A registered provider link (the Clinic projection will do this later): code -> owning organisation. */
export const registerLink = (c: TestCtx, code: string, orgRef: string, kind = 'PROVIDER_LINK') => c.prisma.growthAcquisitionSource.upsert({ where: { market_sourceKind_sourceRef: { market: 'EG', sourceKind: kind, sourceRef: code } }, create: { sourceKind: kind, sourceRef: code, ownerOrgRef: orgRef }, update: { ownerOrgRef: orgRef } });

/** Inserts a touchpoint straight into the table with an arbitrary timestamp (the endpoint always stamps "now"). */
export async function seedTouch(c: TestCtx, o: { kind: string; ageMs?: number; at?: Date; visitorKey?: string | null; sub?: string | null; org?: string | null; dwellMs?: number | null; market?: string; linkCode?: string }) {
  const src = await c.prisma.growthAcquisitionSource.upsert({ where: { market_sourceKind_sourceRef: { market: o.market ?? 'EG', sourceKind: o.kind, sourceRef: o.linkCode ?? '' } }, create: { market: o.market ?? 'EG', sourceKind: o.kind, sourceRef: o.linkCode ?? '' }, update: {} });
  return c.prisma.growthTouchpoint.create({ data: { market: o.market ?? 'EG', visitorKey: o.visitorKey ?? null, sub: o.sub ?? null, sourceId: src.id, kind: o.kind, providerOrgRef: o.org ?? null, linkCode: o.linkCode, landingKind: 'HOME', dwellMs: o.dwellMs === undefined ? 1800 : o.dwellMs, occurredAt: o.at ?? new Date(Date.now() - (o.ageMs ?? 3600_000)), ipHash: 'h' } });
}

/** An approved and ACTIVE growth config version made through the real maker-checker path (two different super admins). */
export async function activateConfig(c: TestCtx, kind: string, payload: Record<string, unknown>, o: { effectiveFrom?: Date; announcement?: string } = {}) {
  const svc = c.get(GrowthConfigService);
  const now = new Date();
  const money = kind === 'ATTRIBUTION_POLICY';
  const d = await svc.createDraft(SUPER_A, { kind, scope: 'GLOBAL', payload, effectiveFrom: o.effectiveFrom ?? (money ? new Date(now.getTime() + 8 * 86_400_000) : now), announcement: o.announcement ?? (money ? 'Providers: the attribution window changes on the effective date.' : undefined), ticket: 'T-1', reason: 'test' });
  await svc.submit(SUPER_A, d.id, now);
  return svc.approve(SUPER_B, d.id, now);
}
export const DAY = 86_400_000;
