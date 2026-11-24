import { Injectable } from '@nestjs/common';
import { generateEnrolmentCode } from '@kiorex/contracts';
import { badRequest, conflict, notFound } from '../common/errors';
import { PrismaService } from '../prisma/prisma.service';
import { CONN_KINDS, type ConnKind } from './steps';

export const ENROLMENT_DEFAULT_TTL_HOURS = 24 * 7;
export const ENROLMENT_MAX_TTL_HOURS = 24 * 14;

/**
 * One-time enrolment codes for the partner intake (ops console, "Partner onboarding"). The code is returned ONCE on creation; only the derived signing key
 * (sha256 of the code) is stored. Single use, expiring, revocable, audited (ids and labels only, never the code).
 */
@Injectable()
export class PartnerEnrolmentService {
  constructor(private readonly prisma: PrismaService) {}

  private audit(actor: string, action: string, id: string, metadata?: object) {
    return this.prisma.auditLog.create({ data: { actor, action: `partner_enrolment.${action}`, resource: 'PartnerEnrolment', resourceId: id, metadata: metadata as any } });
  }
  private view(e: { id: string; kind: string; orgRef: string | null; label: string; status: string; expiresAt: Date; createdBy: string; revokedBy: string | null; revokedAt: Date | null; usedAt: Date | null; connectionId: string | null; createdAt: Date }) {
    const status = e.status === 'ACTIVE' && e.expiresAt <= new Date() ? 'EXPIRED' : e.status;
    return { id: e.id, kind: e.kind, orgRef: e.orgRef, label: e.label, status, expiresAt: e.expiresAt, createdBy: e.createdBy, revokedBy: e.revokedBy, revokedAt: e.revokedAt, usedAt: e.usedAt, connectionId: e.connectionId, createdAt: e.createdAt };
  }

  async create(actor: string, i: { kind: string; label: string; orgRef?: string; ttlHours?: number }) {
    if (!CONN_KINDS.includes(i.kind as ConnKind)) throw badRequest('INVALID_KIND', 'kind must be CLINIC, NURSE, PHARMACY or LAB');
    const label = (i.label ?? '').trim();
    if (label.length < 2 || label.length > 120) throw badRequest('LABEL_REQUIRED', 'Say who this code is for (2 to 120 characters)');
    if (i.orgRef !== undefined && !/^[A-Za-z0-9_.:-]{1,80}$/.test(i.orgRef)) throw badRequest('INVALID_ORG_REF', 'orgRef is not valid');
    const ttl = i.ttlHours ?? ENROLMENT_DEFAULT_TTL_HOURS;
    if (!Number.isFinite(ttl) || ttl < 1 || ttl > ENROLMENT_MAX_TTL_HOURS) throw badRequest('INVALID_TTL', `ttlHours must be 1 to ${ENROLMENT_MAX_TTL_HOURS}`);
    const g = generateEnrolmentCode();
    const e = await this.prisma.partnerEnrolment.create({ data: { id: g.id, kind: i.kind, orgRef: i.orgRef || null, label, signingKey: g.signingKey, expiresAt: new Date(Date.now() + ttl * 3_600_000), createdBy: actor } });
    await this.audit(actor, 'created', e.id, { kind: e.kind, orgRef: e.orgRef, ttlHours: ttl });
    return { ...this.view(e), code: g.code, shownOnce: true };
  }

  async list(opts: { kind?: string; status?: string } = {}) {
    const rows = await this.prisma.partnerEnrolment.findMany({ where: { ...(opts.kind ? { kind: opts.kind } : {}) }, orderBy: { createdAt: 'desc' }, take: 200 });
    const v = rows.map((r) => this.view(r));
    return opts.status ? v.filter((x) => x.status === opts.status) : v;
  }

  async revoke(actor: string, id: string) {
    const e = await this.prisma.partnerEnrolment.findUnique({ where: { id } });
    if (!e) throw notFound('ENROLMENT_NOT_FOUND', 'Enrolment code not found');
    if (e.status === 'USED') throw conflict('ENROLMENT_USED', 'This code was already used');
    if (e.status === 'REVOKED') return this.view(e);
    const u = await this.prisma.partnerEnrolment.update({ where: { id }, data: { status: 'REVOKED', revokedBy: actor, revokedAt: new Date() } });
    await this.audit(actor, 'revoked', id);
    return this.view(u);
  }
}
