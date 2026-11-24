import { Injectable, Logger } from '@nestjs/common';
import { ApiError, badRequest, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { KiorlyClient } from '../kiorly/kiorly-public';

/**
 * GRW-P2-C (contracts 1.12.0): a Clinic provider asks Kiorex ops to update a verified public profile field. The event carries only the request reference, the
 * field and the evidence COUNT. This consumer records the request as an item of the existing partner-onboarding queue (inside the `human` document of the
 * organisation's CLINIC connection: no new table, the KP schema is frozen in W5), ops reads the requested value live from the Clinic over the signed channel
 * (it is never copied here), decides, and the decision goes back as `ProviderVerificationDecided` through `POST /marketplace/v1/provider-verification/decisions`.
 */
export type VerificationDecision = 'APPROVED' | 'REJECTED' | 'NEEDS_INFO';
export interface VerificationUpdateItem { requestRef: string; clinicId: string; field: string; evidenceCount: number; requestedAt: string; status: 'OPEN' | VerificationDecision; decidedAt?: string; decidedBy?: string; note?: string }
const FIELDS = new Set(['LICENSE_NUMBER', 'SPECIALTY', 'ADDRESS', 'DISPLAY_NAME', 'PHOTO', 'DOCUMENT']);
const REF = /^[A-Za-z0-9_-]{1,120}$/;
const MAX_ITEMS = 200;

@Injectable()
export class VerificationUpdateService {
  private readonly log = new Logger('verification-update');
  constructor(private readonly prisma: PrismaService, private readonly kiorly: KiorlyClient) {}

  private items(human: unknown): Record<string, VerificationUpdateItem> {
    const h = (human ?? {}) as { verificationUpdates?: Record<string, VerificationUpdateItem> };
    return h.verificationUpdates && typeof h.verificationUpdates === 'object' ? { ...h.verificationUpdates } : {};
  }

  /** Webhook consumer. Idempotent on requestRef (a re-sent request after NEEDS_INFO re-opens the item). Unknown organisation: acknowledged and ignored. */
  async onRequested(data: Record<string, any>): Promise<'APPLIED' | 'IGNORED'> {
    const requestRef = String(data.requestRef ?? ''); const orgRef = String(data.orgRef ?? ''); const field = String(data.field ?? '');
    if (!REF.test(requestRef) || !orgRef || !FIELDS.has(field)) return 'IGNORED';
    const conn = await this.prisma.partnerConnection.findFirst({ where: { orgRef, kind: { in: ['CLINIC', 'NURSE'] } } });
    if (!conn) { this.log.warn(`verification update for unknown organisation ref=${requestRef}`); return 'IGNORED'; }
    const items = this.items(conn.human);
    const prev = items[requestRef];
    if (Object.keys(items).length >= MAX_ITEMS && !prev) return 'IGNORED';
    items[requestRef] = { requestRef, clinicId: String(data.clinicId ?? '').slice(0, 120), field, evidenceCount: Math.min(10, Math.max(0, Number(data.evidenceCount) || 0)), requestedAt: typeof data.requestedAt === 'string' ? data.requestedAt : new Date().toISOString(), status: 'OPEN' };
    await this.prisma.partnerConnection.update({ where: { id: conn.id }, data: { human: { ...((conn.human ?? {}) as object), verificationUpdates: items } as any } });
    await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: 'partner_onboarding.verification_update_requested', resource: 'PartnerConnection', resourceId: conn.id, metadata: { requestRef, field, evidenceCount: items[requestRef]!.evidenceCount, reopened: !!prev } } });
    return 'APPLIED';
  }

  /** The ops queue: open items first. No requested value here. */
  async list(q: { status?: string } = {}) {
    const rows = await this.prisma.partnerConnection.findMany({ where: { kind: { in: ['CLINIC', 'NURSE'] } }, select: { id: true, name: true, orgRef: true, human: true }, take: 500 });
    const out = rows.flatMap((r) => Object.values(this.items(r.human)).map((i) => ({ ...i, connectionId: r.id, organisation: r.name, orgRef: r.orgRef })));
    return out.filter((i) => !q.status || i.status === q.status).sort((a, b) => (a.status === 'OPEN' ? 0 : 1) - (b.status === 'OPEN' ? 0 : 1) || (a.requestedAt < b.requestedAt ? 1 : -1)).slice(0, 200);
  }

  private async find(requestRef: string) {
    if (!REF.test(requestRef)) throw badRequest('VERIFICATION_REF_INVALID', 'Invalid request reference');
    const rows = await this.prisma.partnerConnection.findMany({ where: { kind: { in: ['CLINIC', 'NURSE'] } }, take: 500 });
    for (const r of rows) { const item = this.items(r.human)[requestRef]; if (item) return { conn: r, item }; }
    throw notFound('VERIFICATION_REQUEST_NOT_FOUND', 'No such verification update request');
  }

  /** The requested value and the evidence references, read live from the Clinic (signed call). Never persisted here. */
  async detail(requestRef: string) {
    const { conn, item } = await this.find(requestRef);
    let live: unknown = null;
    try { live = (await this.kiorly.request({ method: 'GET', path: `/provider-verification/requests/${encodeURIComponent(requestRef)}` })).data; } catch (e) { this.log.warn(`could not read request ${requestRef}: ${(e as Error).message}`); }
    return { ...item, connectionId: conn.id, organisation: conn.name, live };
  }

  async decide(actor: string, requestRef: string, decision: string, note?: string) {
    if (!['APPROVED', 'REJECTED', 'NEEDS_INFO'].includes(decision)) throw badRequest('VERIFICATION_DECISION_INVALID', 'decision must be APPROVED, REJECTED or NEEDS_INFO');
    const clean = (note ?? '').replace(/[\u0000-\u001f\u007f<>]/g, ' ').trim().slice(0, 300);
    if (decision !== 'APPROVED' && clean.length < 5) throw badRequest('VERIFICATION_NOTE_REQUIRED', 'A note of at least 5 characters is required to reject or ask for more information');
    const { conn, item } = await this.find(requestRef);
    if (item.status !== 'OPEN') throw new ApiError(409, 'VERIFICATION_ALREADY_DECIDED', 'This request was already decided');
    const decidedAt = new Date().toISOString();
    const body = { requestRef, kiorexRef: `kxv_${requestRef.slice(-12)}`, orgRef: conn.orgRef, clinicId: item.clinicId, decision, ...(clean ? { note: clean } : {}), decidedAt };
    // Clinic first: when it cannot be reached the item stays OPEN and ops can retry (the Clinic call is idempotent on the request).
    await this.kiorly.request({ method: 'POST', path: '/provider-verification/decisions', body });
    const items = this.items(conn.human);
    items[requestRef] = { ...item, status: decision as VerificationDecision, decidedAt, decidedBy: actor, ...(clean ? { note: clean } : {}) };
    await this.prisma.partnerConnection.update({ where: { id: conn.id }, data: { human: { ...((conn.human ?? {}) as object), verificationUpdates: items } as any } });
    await this.prisma.auditLog.create({ data: { actor, action: 'partner_onboarding.verification_update_decided', resource: 'PartnerConnection', resourceId: conn.id, metadata: { requestRef, field: item.field, decision } } });
    return items[requestRef]!;
  }
}
