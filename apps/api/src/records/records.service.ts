import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { SharedRecord } from '@prisma/client';
import { createHash, createHmac } from 'node:crypto';
import { cfg } from '../common/config';
import { decryptField, encryptField, safeEqual, sha256Hex } from '../common/crypto';
import { badRequest, notFound } from '../common/errors';
import { newId } from '../common/ids';
import { FlagsService } from '../control-plane/control-plane-public';
import { EngagementService } from '../engagement/engagement-public';
import { KiorlyClient } from '../kiorly/kiorly-public';
import { OutboxService } from '../outbox/outbox-public';
import { PatientService } from '../patient/patient-public';
import { PrismaService } from '../prisma/prisma.service';
import { parseRxToken, rxQrPayload, rxToken, rxTokenValid, rxVerifyUrl } from './rx';
import { STORAGE, StorageAdapter } from './storage';

export const SHARE_SCOPES = ['VISIT_SUMMARY', 'PRESCRIPTIONS', 'LAB_RESULTS', 'SHARE_WITH_OTHER_CLINICS'] as const;
export type ShareScope = (typeof SHARE_SCOPES)[number];
const KIND_OF_SCOPE: Partial<Record<ShareScope, string>> = { VISIT_SUMMARY: 'VISIT_SUMMARY', PRESCRIPTIONS: 'PRESCRIPTION', LAB_RESULTS: 'LAB_RESULT' };
const UPLOAD_MIME: Record<string, (b: Buffer) => boolean> = {
  'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
  'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
  'image/png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
};
const FLAG_SHARING = 'clinic.record_share_patient_app';
const FLAG_VAULT = 'kiorex.record_vault';

type Outcome = 'APPLIED' | 'IGNORED' | 'UNMAPPED_PATIENT';

/**
 * Records & continuity (KXM-RC-01..03, KX-11). Clinical content is AES-GCM encrypted at rest, returned only to the owning
 * patient, redacted from webhook receipts, and NEVER written to logs or analytics.
 */
@Injectable()
export class RecordsService implements OnModuleInit {
  constructor(
    private readonly prisma: PrismaService, private readonly patients: PatientService, private readonly outbox: OutboxService, private readonly kiorly: KiorlyClient,
    private readonly flags: FlagsService, private readonly engagement: EngagementService, @Inject(STORAGE) private readonly storage: StorageAdapter,
  ) {}

  onModuleInit() {
    this.outbox.register('kiorly.record_share_consent', (e) => this.pushConsent(e.payload));
    this.patients.registerExport('vault', async (sub) => {
      const rows = await this.prisma.sharedRecord.findMany({ where: { sub, status: 'ACTIVE' } });
      return rows.map((r) => ({ ...this.present(r), content: r.payloadEnc ? JSON.parse(decryptField(r.payloadEnc)) : null }));
    });
    this.patients.registerAnonymizer('vault', async (sub) => { await this.deleteAllFor(sub); });
  }

  // ───────────── flags ─────────────

  private async market(sub: string) { return (await this.patients.profileBySub(sub))?.market ?? 'EG'; }
  async vaultWritable(sub: string) { return this.flags.isEnabled(FLAG_VAULT, { market: await this.market(sub) }); }
  async canGrantSharing(sub: string) {
    const m = await this.market(sub);
    return (await this.flags.isEnabled(FLAG_VAULT, { market: m })) && (await this.flags.isEnabled(FLAG_SHARING, { market: m }));
  }

  // ───────────── presentation ─────────────

  present(r: SharedRecord) {
    return {
      id: r.id, kind: r.kind, title: r.title, source: r.kind === 'UPLOAD' ? 'PATIENT' : r.kind === 'LAB_RESULT' ? 'LAB' : 'CLINIC', clinicId: r.clinicId, dependantId: r.dependantId, signedAt: r.signedAt?.toISOString() ?? null,
      hasFile: !!r.storageKey, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, createdAt: r.createdAt.toISOString(),
    };
  }

  async list(sub: string, kind?: string) {
    const rows = await this.prisma.sharedRecord.findMany({ where: { sub, status: 'ACTIVE', ...(kind ? { kind } : {}) }, orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }], take: 200 });
    return { items: rows.map((r) => this.present(r)), readOnly: !(await this.vaultWritable(sub)) };
  }

  private async owned(sub: string, id: string): Promise<SharedRecord> {
    const r = await this.prisma.sharedRecord.findUnique({ where: { id } });
    if (!r || r.sub !== sub || r.status !== 'ACTIVE') throw notFound('RECORD_NOT_FOUND', 'Record not found');
    return r;
  }

  async detail(sub: string, id: string) {
    const r = await this.owned(sub, id);
    const base = this.present(r);
    const content = r.payloadEnc ? (JSON.parse(decryptField(r.payloadEnc)) as Record<string, any>) : undefined;
    if (r.kind === 'VISIT_SUMMARY') return { ...base, content };
    if (r.kind === 'LAB_RESULT') return { ...base, report: content };
    if (r.kind === 'PRESCRIPTION') return { ...base, prescription: { encounterId: content?.encounterId ?? r.sourceRef, clinicId: r.clinicId, items: content?.items ?? null, itemsAvailable: Array.isArray(content?.items) }, verification: this.verification(r) };
    return base;
  }

  private verification(r: SharedRecord) {
    const token = rxToken(r.id, r.signedAt ?? r.createdAt);
    return { token, qrPayload: rxQrPayload(token), verifyUrl: rxVerifyUrl(token) };
  }

  async prescriptions(sub: string) {
    const rows = await this.prisma.sharedRecord.findMany({ where: { sub, kind: 'PRESCRIPTION', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 100 });
    return rows.map((r) => ({ ...this.present(r), verification: this.verification(r) }));
  }

  /** Public pharmacist-facing check. Reveals validity, clinic id and signed date only. */
  async verifyRx(token: string) {
    const p = parseRxToken(token);
    if (!p) return { valid: false, status: 'UNKNOWN' };
    const r = await this.prisma.sharedRecord.findUnique({ where: { id: p.recordId } });
    if (!r || r.kind !== 'PRESCRIPTION' || !rxTokenValid(r.id, r.signedAt ?? r.createdAt, p.mac)) return { valid: false, status: 'UNKNOWN' };
    if (r.status !== 'ACTIVE') return { valid: false, status: 'REVOKED' };
    return { valid: true, status: 'ACTIVE', clinicId: r.clinicId ?? undefined, signedAt: (r.signedAt ?? r.createdAt).toISOString() };
  }

  // ───────────── patient uploads (local storage adapter) ─────────────

  async upload(sub: string, i: { fileName: string; mimeType: string; contentBase64: string; title?: string }) {
    const check = UPLOAD_MIME[i.mimeType];
    if (!check) throw badRequest('UNSUPPORTED_FILE_TYPE', 'Only PDF, JPEG and PNG files can be uploaded', { allowed: Object.keys(UPLOAD_MIME) });
    if (!/^[A-Za-z0-9+/=\s]+$/.test(i.contentBase64 ?? '')) throw badRequest('INVALID_CONTENT', 'contentBase64 must be base64');
    const buf = Buffer.from(i.contentBase64, 'base64');
    if (!buf.length) throw badRequest('EMPTY_FILE', 'File is empty');
    if (buf.length > cfg().vaultMaxBytes) throw badRequest('FILE_TOO_LARGE', `Max ${cfg().vaultMaxBytes} bytes`, { maxBytes: cfg().vaultMaxBytes });
    if (!check(buf)) throw badRequest('MIME_MISMATCH', 'File content does not match its declared type');
    const id = newId('kx_rec');
    const key = `${createHash('sha1').update(sub).digest('hex').slice(0, 12)}/${id}`;
    await this.storage.put(key, buf);
    const name = i.fileName.replace(/[\\/\0]/g, '_').slice(0, 120);
    const r = await this.prisma.sharedRecord.create({ data: { id, sub, kind: 'UPLOAD', title: (i.title ?? name).slice(0, 120), storageKey: key, fileName: name, mimeType: i.mimeType, sizeBytes: buf.length, sha256: sha256Hex(buf), signedAt: null } });
    return this.present(r);
  }

  async content(sub: string, id: string): Promise<{ bytes: Buffer; mimeType: string; fileName: string }> {
    const r = await this.owned(sub, id);
    if (!r.storageKey) throw notFound('NO_FILE', 'This record has no file');
    return { bytes: await this.storage.get(r.storageKey), mimeType: r.mimeType ?? 'application/octet-stream', fileName: r.fileName ?? 'file' };
  }

  /** Patient removes a record from the vault. Always allowed (flag OFF never blocks a patient's right to delete). */
  async remove(sub: string, id: string) {
    const r = await this.owned(sub, id);
    await this.purge(r, 'PATIENT_DELETED');
    return { ok: true };
  }

  private async purge(r: SharedRecord, reason: string) {
    if (r.storageKey) await this.storage.delete(r.storageKey).catch(() => undefined);
    await this.prisma.sharedRecord.update({ where: { id: r.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, payloadEnc: null, storageKey: null, fileName: null, sha256: null, title: null } });
    await this.cancelFollowUpsForRecord(r.id);
  }
  private async deleteAllFor(sub: string) {
    for (const r of await this.prisma.sharedRecord.findMany({ where: { sub, status: 'ACTIVE' } })) await this.purge(r, 'ACCOUNT_DELETED');
    await this.prisma.recordShareConsent.deleteMany({ where: { sub } });
  }

  // ───────────── record-share consent (per scope) ─────────────

  async sharing(sub: string) {
    const rows = await this.prisma.recordShareConsent.findMany({ where: { sub } });
    return { scopes: SHARE_SCOPES.map((scope) => { const r = rows.find((x) => x.scope === scope); return { scope, granted: !!r?.granted, updatedAt: r?.updatedAt.toISOString() ?? null }; }), canGrant: await this.canGrantSharing(sub) };
  }

  /** Granting needs both flags (OFF => 403 FEATURE_DISABLED, no NEW sharing). Revoking is ALWAYS possible and deletes Kiorex copies immediately. */
  async setSharing(sub: string, scope: string, granted: boolean) {
    if (!(SHARE_SCOPES as readonly string[]).includes(scope)) throw badRequest('UNKNOWN_SCOPE', 'Unknown record-share scope', { allowed: SHARE_SCOPES });
    const m = await this.market(sub);
    if (granted) { await this.flags.assertEnabled(FLAG_VAULT, { market: m }); await this.flags.assertEnabled(FLAG_SHARING, { market: m }); }
    await this.prisma.recordShareConsent.upsert({ where: { sub_scope: { sub, scope } }, create: { sub, scope, granted }, update: { granted } });
    const any = await this.prisma.recordShareConsent.count({ where: { sub, granted: true } });
    await this.patients.setConsent(sub, 'RECORD_SHARING', any > 0, 'vault');
    if (!granted) await this.deleteScopeCopies(sub, scope as ShareScope, 'REVOKED_BY_PATIENT');
    const links = await this.prisma.kiorlyPatientLink.findMany({ where: { sub, status: 'LINKED' } });
    for (const l of links) {
      await this.outbox.enqueue(this.prisma, { type: 'kiorly.record_share_consent', target: 'KIORLY', aggregateType: 'RecordShareConsent', aggregateId: `${sub}:${l.kiorlyPatientId}`, payload: { kiorlyPatientId: l.kiorlyPatientId, clinicId: l.clinicId, scope, granted }, dedupeKey: `kiorly.record_share_consent:${l.kiorlyPatientId}:${scope}:${granted}:${Date.now()}` });
    }
    return this.sharing(sub);
  }

  private async pushConsent(p: { kiorlyPatientId: string; clinicId?: string; scope: string; granted: boolean }) {
    await this.kiorly.upsertRecordShareConsents(p.kiorlyPatientId, [{ scope: p.scope, granted: p.granted }], p.clinicId);
  }

  private async deleteScopeCopies(sub: string, scope: ShareScope, reason: string) {
    const kind = KIND_OF_SCOPE[scope];
    if (!kind) return 0;
    const rows = await this.prisma.sharedRecord.findMany({ where: { sub, kind, status: 'ACTIVE' } });
    for (const r of rows) await this.purge(r, reason);
    return rows.length;
  }

  // ───────────── Kiorly record-share events (KX-11) ─────────────

  /** Receipts keep metadata only: clinical content is stripped before the payload is persisted. */
  static redactEnvelope(env: any) {
    const d = env?.data;
    if (!d) return env;
    if (env.type === 'VISIT_SUMMARY_SHARED') return { ...env, data: { ...d, summary: d.summary ? { encounterId: d.summary.encounterId, clinicId: d.summary.clinicId, signedAt: d.summary.signedAt, soap: '[REDACTED]' } : undefined } };
    if (env.type === 'PRESCRIPTION_SHARED') return { ...env, data: { ...d, items: d.items ? '[REDACTED]' : undefined } };
    return env;
  }

  private async subsFor(kiorlyPatientId: string) {
    return this.prisma.kiorlyPatientLink.findMany({ where: { kiorlyPatientId, status: 'LINKED' } });
  }
  private async intakeAllowed(sub: string) {
    const m = await this.market(sub);
    return (await this.flags.isEnabled(FLAG_VAULT, { market: m })) && (await this.flags.isEnabled(FLAG_SHARING, { market: m }));
  }
  private async patientRevokedLocally(sub: string, scope: ShareScope) {
    const c = await this.prisma.recordShareConsent.findUnique({ where: { sub_scope: { sub, scope } } });
    return !!c && !c.granted;
  }

  async onKiorlyEvent(env: { type: string; eventId?: string; aggregateId?: string; data: Record<string, any> }): Promise<Outcome> {
    const d = env.data;
    if (env.type === 'RECORD_SHARE_REVOKED') return this.onRevoked(d);
    const links = await this.subsFor(String(d.patientId ?? ''));
    if (!links.length) return 'UNMAPPED_PATIENT';
    if (env.type === 'VISIT_SUMMARY_SHARED') {
      const expect = createHmac('sha256', cfg().recordShareSecret).update(JSON.stringify(d.summary ?? null), 'utf8').digest('hex');
      if (!d.summary || typeof d.signature !== 'string' || !safeEqual(expect, d.signature)) {
        await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: 'records.invalid_signature', resource: 'WebhookReceipt', resourceId: env.eventId ?? null } });
        return 'IGNORED'; // non-retryable: a bad signature never becomes valid
      }
    }
    let applied = false;
    for (const l of links) {
      const scope: ShareScope = env.type === 'PRESCRIPTION_SHARED' ? 'PRESCRIPTIONS' : 'VISIT_SUMMARY';
      if (!(await this.intakeAllowed(l.sub))) continue; // kiorex.record_vault / clinic.record_share_patient_app OFF: no new shares
      if (await this.patientRevokedLocally(l.sub, scope)) continue;
      if (env.type === 'VISIT_SUMMARY_SHARED') await this.storeVisitSummary(l, d, env.eventId);
      else await this.storePrescription(l, d, env.eventId);
      applied = true;
    }
    return applied ? 'APPLIED' : 'IGNORED';
  }

  private async upsertRecord(l: { sub: string; clinicId: string; kiorlyPatientId: string; dependantId: string | null }, kind: string, sourceRef: string, data: { title: string; payload: unknown; signedAt: Date | null; eventId?: string }) {
    const where = { sub_kind_sourceRef: { sub: l.sub, kind, sourceRef } };
    const fields = { clinicId: l.clinicId, kiorlyPatientId: l.kiorlyPatientId, dependantId: l.dependantId, title: data.title, payloadEnc: encryptField(JSON.stringify(data.payload)), signedAt: data.signedAt, sourceEventId: data.eventId, status: 'ACTIVE', revokedAt: null, revokedReason: null };
    const existing = await this.prisma.sharedRecord.findUnique({ where });
    const rec = existing
      ? await this.prisma.sharedRecord.update({ where, data: fields })
      : await this.prisma.sharedRecord.create({ data: { id: newId('kx_rec'), sub: l.sub, kind, sourceRef, ...fields } });
    return { rec, isNew: !existing || existing.status !== 'ACTIVE' };
  }

  private async storeVisitSummary(l: any, d: any, eventId?: string) {
    const s = d.summary;
    const { rec, isNew } = await this.upsertRecord(l, 'VISIT_SUMMARY', String(s.encounterId), { title: 'Visit summary', payload: { encounterId: s.encounterId, soap: s.soap }, signedAt: s.signedAt ? new Date(s.signedAt) : null, eventId });
    const days = Number(s.followUp?.intervalDays ?? s.followUpDays); // additive optional field (KXM-RC-03); Kiorly emits none today
    if (Number.isInteger(days) && days >= 1 && days <= 730 && isNew) await this.createFollowUp({ sub: l.sub, recordId: rec.id, clinicId: l.clinicId, afterDays: days, source: 'DOCTOR', from: rec.signedAt ?? new Date() });
    if (isNew) await this.engagement.notify(l.sub, { kind: 'RECORD_SHARED', dedupeKey: `RECORD_SHARED:${rec.id}:${rec.updatedAt.getTime()}` });
  }
  private async storePrescription(l: any, d: any, eventId?: string) {
    const { rec, isNew } = await this.upsertRecord(l, 'PRESCRIPTION', String(d.encounterId), { title: 'Prescription', payload: { encounterId: d.encounterId, clinicId: d.clinicId, items: Array.isArray(d.items) ? d.items : undefined }, signedAt: d.signedAt ? new Date(d.signedAt) : null, eventId });
    if (isNew) await this.engagement.notify(l.sub, { kind: 'RECORD_SHARED', dedupeKey: `RECORD_SHARED:${rec.id}:${rec.updatedAt.getTime()}` });
  }

  private async onRevoked(d: any): Promise<Outcome> {
    const links = await this.subsFor(String(d.patientId ?? ''));
    if (!links.length) return 'UNMAPPED_PATIENT';
    const scope = d.scope as ShareScope;
    if (!(SHARE_SCOPES as readonly string[]).includes(scope)) return 'IGNORED';
    for (const l of links) {
      await this.prisma.recordShareConsent.upsert({ where: { sub_scope: { sub: l.sub, scope } }, create: { sub: l.sub, scope, granted: false }, update: { granted: false } });
      await this.deleteScopeCopies(l.sub, scope, 'REVOKED_IN_KIORLY');
    }
    return 'APPLIED';
  }

  /** LabResultReleased (KX-07): vault entry with the signed report's secure link only, never values (KLCRIT03). */
  async storeLabResult(i: { patientRef: string; reportId: string; orderId: string; labId: string; reportVersion: number; signedAt: string; secureLink: string; channels?: string[] }): Promise<Outcome> {
    let target: { sub: string; clinicId: string; kiorlyPatientId: string; dependantId: string | null } | null = null;
    const profile = await this.prisma.patientProfile.findUnique({ where: { sub: i.patientRef } });
    if (profile) target = { sub: profile.sub, clinicId: i.labId, kiorlyPatientId: '', dependantId: null };
    else { const l = (await this.subsFor(i.patientRef))[0]; if (l) target = l; }
    if (!target) return 'UNMAPPED_PATIENT';
    if (i.channels && !i.channels.includes('KIOREX_VAULT')) return 'IGNORED'; // released through other consented channels only
    if (!(await this.vaultWritable(target.sub))) return 'IGNORED';
    if (await this.patientRevokedLocally(target.sub, 'LAB_RESULTS')) return 'IGNORED';
    const { rec, isNew } = await this.upsertRecord({ ...target, clinicId: i.labId }, 'LAB_RESULT', i.reportId, { title: 'Lab report', payload: { reportId: i.reportId, orderId: i.orderId, labId: i.labId, reportVersion: i.reportVersion, secureLink: i.secureLink }, signedAt: new Date(i.signedAt) });
    await this.engagement.notify(target.sub, { kind: 'LAB_RESULT_RELEASED', dedupeKey: `LAB_RESULT_RELEASED:${rec.id}:${i.reportVersion}` });
    void isNew;
    return 'APPLIED';
  }

  // ───────────── follow-up reminders (KXM-RC-03) ─────────────

  async createFollowUp(i: { sub: string; recordId?: string; clinicId?: string; afterDays?: number; dueAt?: Date; source: 'DOCTOR' | 'PATIENT'; from?: Date }) {
    const due = i.dueAt ?? new Date((i.from ?? new Date()).getTime() + (i.afterDays ?? 0) * 86400_000);
    if (!(i.afterDays && i.afterDays >= 1 && i.afterDays <= 730) && !i.dueAt) throw badRequest('INVALID_INTERVAL', 'afterDays must be 1-730');
    if (i.recordId) await this.owned(i.sub, i.recordId);
    const f = await this.prisma.followUpReminder.create({ data: { id: newId('kx_fu'), sub: i.sub, recordId: i.recordId, clinicId: i.clinicId, dueAt: due, source: i.source } });
    // the engagement scheduler delivers it at dueAt (REMINDERS consent + quiet hours + opt-out apply); bookingId doubles as the cancel handle
    await this.engagement.notify(i.sub, { kind: 'FOLLOW_UP_DUE', bookingId: f.id, scheduledFor: due, dedupeKey: `FOLLOW_UP_DUE:${f.id}` });
    return this.presentFollowUp(f);
  }
  private presentFollowUp(f: { id: string; recordId: string | null; clinicId: string | null; dueAt: Date; source: string; status: string }) {
    return { id: f.id, recordId: f.recordId, clinicId: f.clinicId, dueAt: f.dueAt.toISOString(), source: f.source, status: f.status === 'CANCELLED' ? 'CANCELLED' : f.dueAt <= new Date() ? 'DUE' : 'SCHEDULED' };
  }
  async followUps(sub: string) {
    const rows = await this.prisma.followUpReminder.findMany({ where: { sub, status: { not: 'CANCELLED' } }, orderBy: { dueAt: 'asc' }, take: 100 });
    return rows.map((f) => this.presentFollowUp(f));
  }
  async cancelFollowUp(sub: string, id: string) {
    const r = await this.prisma.followUpReminder.updateMany({ where: { id, sub, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
    if (!r.count) throw notFound('FOLLOW_UP_NOT_FOUND', 'Follow-up not found');
    await this.engagement.cancelBookingMessages(id);
    return { ok: true };
  }
  private async cancelFollowUpsForRecord(recordId: string) {
    const rows = await this.prisma.followUpReminder.findMany({ where: { recordId, status: { not: 'CANCELLED' } } });
    for (const f of rows) { await this.prisma.followUpReminder.update({ where: { id: f.id }, data: { status: 'CANCELLED' } }); await this.engagement.cancelBookingMessages(f.id); }
  }
  async followUpForOwner(sub: string, recordId: string, afterDays: number) {
    const r = await this.owned(sub, recordId);
    return this.createFollowUp({ sub, recordId, clinicId: r.clinicId ?? undefined, afterDays, source: 'PATIENT' });
  }
}
