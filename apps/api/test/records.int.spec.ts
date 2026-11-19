import { createHmac } from 'node:crypto';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createCtx, TestCtx } from './harness';
import { OutboxService } from '../src/outbox/outbox-public';
import { EngagementService } from '../src/engagement/engagement-public';

const SECRET = 'dev-record-share-secret';
const sign = (summary: unknown) => createHmac('sha256', SECRET).update(JSON.stringify(summary), 'utf8').digest('hex');
const SOAP = { chiefComplaint: 'SECRET-CC-xyz', subjective: null, objective: null, assessment: 'SECRET-ASSESSMENT', plan: 'rest' };
const summary = (enc = 'enc_1', extra: Record<string, unknown> = {}) => ({ encounterId: enc, clinicId: 'cl_1', signedAt: '2026-11-18T10:00:00.000Z', soap: SOAP, ...extra });
const PDF = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.from('patient-private-content'), Buffer.alloc(200, 1)]);

describe('records & continuity — vault, record shares, prescriptions, follow-ups (KXM-RC-01..03)', () => {
  let c: TestCtx; let auth: { Authorization: string }; let admin: { Authorization: string };
  beforeAll(async () => { c = await createCtx(); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => {
    await c.reset();
    auth = await c.as('sub_amira');
    admin = await c.as('adm1', { roles: ['super_admin', 'ops_admin'] });
    await c.http().put('/api/v1/me/profile').set(auth).send({ nameEn: 'Amira Samy' }).expect(200);
    await c.prisma.kiorlyPatientLink.create({ data: { sub: 'sub_amira', clinicId: 'cl_1', kiorlyPatientId: 'pat_1', evidence: 'PHONE' } });
    process.env.QUIET_HOURS_START = '0'; process.env.QUIET_HOURS_END = '0';
  });
  afterEach(() => { delete process.env.VAULT_MAX_BYTES; });
  const share = (s = summary(), o: any = {}) => c.webhook('VISIT_SUMMARY_SHARED', { patientId: 'pat_1', scope: 'VISIT_SUMMARY', summary: s, signature: sign(s), ...o }, { aggregateType: 'Encounter', aggregateId: s.encounterId });
  const rx = (enc = 'enc_1') => c.webhook('PRESCRIPTION_SHARED', { patientId: 'pat_1', scope: 'PRESCRIPTIONS', encounterId: enc, clinicId: 'cl_1', signedAt: '2026-11-18T10:00:00.000Z' }, { aggregateType: 'Encounter', aggregateId: enc });
  const off = (key: string) => c.http().put(`/api/v1/admin/flags/${key}/values`).set(admin).send({ scope: 'GLOBAL', value: 'OFF', reason: 't', ticket: 'T-1', emergency: true }).expect(200);

  it('RC-01 visit summary share: stored encrypted, listed, viewable by the owner only, receipt redacted, idempotent re-delivery', async () => {
    const r = await share();
    expect(r.body.status).toBe('APPLIED');
    const list = await c.http().get('/api/v1/me/vault').set(auth).expect(200);
    expect(list.body.readOnly).toBe(false);
    expect(list.body.items).toHaveLength(1);
    expect(list.body.items[0]).toMatchObject({ kind: 'VISIT_SUMMARY', source: 'CLINIC', clinicId: 'cl_1', hasFile: false });
    expect(JSON.stringify(list.body)).not.toContain('SECRET-');
    const id = list.body.items[0].id;
    const d = await c.http().get(`/api/v1/me/vault/${id}`).set(auth).expect(200);
    expect(d.body.content.soap.assessment).toBe('SECRET-ASSESSMENT');
    await c.http().get(`/api/v1/me/vault/${id}`).set(await c.as('sub_other')).expect(404);
    // at rest: encrypted column; receipt: redacted (PHI never persisted outside the vault)
    const row = await c.prisma.sharedRecord.findUniqueOrThrow({ where: { id } });
    expect(row.payloadEnc).toMatch(/^v1\./); expect(row.payloadEnc).not.toContain('SECRET');
    const rec = await c.prisma.webhookReceipt.findFirstOrThrow({ where: { type: 'VISIT_SUMMARY_SHARED' } });
    expect(JSON.stringify(rec.payload)).not.toContain('SECRET-');
    expect(JSON.stringify(rec.payload)).toContain('[REDACTED]');
    await share(); // new eventId, same encounter: upsert, not a duplicate record
    expect((await c.http().get('/api/v1/me/vault').set(auth)).body.items).toHaveLength(1);
    expect((await c.http().get('/api/v1/me/notifications').set(auth)).body.some((n: any) => n.kind === 'RECORD_SHARED')).toBe(true);
  });

  it('RC-01 rejects a share with a bad signature (non-retryable, nothing stored) and ignores unlinked patients', async () => {
    const r = await share(summary(), { signature: 'deadbeef' });
    expect(r.body.status).toBe('IGNORED');
    expect(await c.prisma.sharedRecord.count()).toBe(0);
    expect((await c.prisma.auditLog.findFirstOrThrow({ where: { action: 'records.invalid_signature' } })).resourceId).toBeTruthy();
    const u = await share(summary(), { patientId: 'pat_unknown' });
    expect(u.status).toBe(200);
    expect(await c.prisma.sharedRecord.count()).toBe(0);
  });

  it('RC-02 prescription view with verification QR; public verify answers validity only; revoked => invalid', async () => {
    expect((await rx()).body.status).toBe('APPLIED');
    const l = await c.http().get('/api/v1/me/prescriptions').set(auth).expect(200);
    expect(l.body).toHaveLength(1);
    const d = await c.http().get(`/api/v1/me/vault/${l.body[0].id}`).set(auth).expect(200);
    expect(d.body.prescription).toMatchObject({ clinicId: 'cl_1', items: null, itemsAvailable: false });
    expect(d.body.verification.qrPayload).toContain(encodeURIComponent(d.body.verification.token));
    const v = await c.http().get(`/api/v1/rx/verify?t=${encodeURIComponent(d.body.verification.token)}`).expect(200);
    expect(v.body).toEqual({ valid: true, status: 'ACTIVE', clinicId: 'cl_1', signedAt: '2026-11-18T10:00:00.000Z' }); // no patient data
    expect((await c.http().get('/api/v1/rx/verify?t=kxrx1.kx_rec_x.AAAAAAAAAAAAAAAAAAAAAAAA')).body.valid).toBe(false);
    expect((await c.http().get(`/api/v1/rx/verify?t=${encodeURIComponent(d.body.verification.token.slice(0, -1) + 'x')}`)).body.valid).toBe(false);
    await c.http().delete(`/api/v1/me/vault/${l.body[0].id}`).set(auth).expect(200);
    expect((await c.http().get(`/api/v1/rx/verify?t=${encodeURIComponent(d.body.verification.token)}`)).body).toEqual({ valid: false, status: 'REVOKED' });
  });

  it('RC-01 RECORD_SHARE_REVOKED from Kiorly deletes shared copies of that scope only', async () => {
    await share(); await rx('enc_2');
    const r = await c.webhook('RECORD_SHARE_REVOKED', { patientId: 'pat_1', scope: 'VISIT_SUMMARY', action: 'DELETE_REQUESTED' }, { aggregateType: 'Patient', aggregateId: 'pat_1' });
    expect(r.body.status).toBe('APPLIED');
    const items = (await c.http().get('/api/v1/me/vault').set(auth)).body.items;
    expect(items.map((i: any) => i.kind)).toEqual(['PRESCRIPTION']);
    const gone = await c.prisma.sharedRecord.findFirstOrThrow({ where: { kind: 'VISIT_SUMMARY' } });
    expect(gone).toMatchObject({ status: 'REVOKED', payloadEnc: null, title: null });
    // a later share is ignored while the patient's revocation stands
    expect((await share(summary('enc_3'))).body.status).toBe('IGNORED');
    const sharing = (await c.http().get('/api/v1/me/record-sharing').set(auth)).body;
    expect(sharing.scopes.find((s: any) => s.scope === 'VISIT_SUMMARY').granted).toBe(false);
  });

  it('RC-01 patient grants/revokes a scope in Kiorex: consent mirrored to Kiorly through the outbox; revoke deletes copies', async () => {
    await c.http().put('/api/v1/me/record-sharing/BOGUS').set(auth).send({ granted: true }).expect(400);
    const g = await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: true }).expect(200);
    expect(g.body.scopes.find((s: any) => s.scope === 'VISIT_SUMMARY').granted).toBe(true);
    expect((await c.http().get('/api/v1/me/consents').set(auth)).body.find((x: any) => x.purpose === 'RECORD_SHARING').granted).toBe(true);
    await c.get(OutboxService).processBatch();
    expect(c.kiorly.consentPushes).toEqual([{ patientId: 'pat_1', consents: [{ scope: 'VISIT_SUMMARY', granted: true }] }]);
    await share();
    await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: false }).expect(200);
    expect((await c.http().get('/api/v1/me/vault').set(auth)).body.items).toHaveLength(0);
    await c.get(OutboxService).processBatch();
    expect(c.kiorly.consentPushes.at(-1)).toEqual({ patientId: 'pat_1', consents: [{ scope: 'VISIT_SUMMARY', granted: false }] });
    expect((await c.http().get('/api/v1/me/consents').set(auth)).body.find((x: any) => x.purpose === 'RECORD_SHARING').granted).toBe(false);
  });

  it('flags: kiorex.record_vault OFF => vault read-only (list/view/delete work; upload, grant, new shares blocked)', async () => {
    await share();
    const id = (await c.http().get('/api/v1/me/vault').set(auth)).body.items[0].id;
    await off('kiorex.record_vault');
    const l = await c.http().get('/api/v1/me/vault').set(auth).expect(200);
    expect(l.body).toMatchObject({ readOnly: true }); expect(l.body.items).toHaveLength(1);
    await c.http().get(`/api/v1/me/vault/${id}`).set(auth).expect(200);
    const up = await c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: 'a.pdf', mimeType: 'application/pdf', contentBase64: PDF.toString('base64') }).expect(403);
    expect(up.body).toMatchObject({ code: 'FEATURE_DISABLED', key: 'kiorex.record_vault' });
    await c.http().put('/api/v1/me/record-sharing/PRESCRIPTIONS').set(auth).send({ granted: true }).expect(403);
    expect((await rx()).body.status).toBe('IGNORED'); // no new shares while read-only
    expect((await c.http().get('/api/v1/me/vault').set(auth)).body.items).toHaveLength(1);
    await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: false }).expect(200); // revoking is never blocked
    await c.http().delete(`/api/v1/me/vault/${id}`).set(auth).expect(404); // already purged by the revoke
  });

  it('flags: clinic.record_share_patient_app OFF => no NEW shares or grants; existing shares stay visible', async () => {
    await share();
    await off('clinic.record_share_patient_app');
    expect((await share(summary('enc_9'))).body.status).toBe('IGNORED');
    expect((await c.http().get('/api/v1/me/vault').set(auth)).body.items).toHaveLength(1);
    const s = await c.http().get('/api/v1/me/record-sharing').set(auth);
    expect(s.body.canGrant).toBe(false);
    await c.http().put('/api/v1/me/record-sharing/VISIT_SUMMARY').set(auth).send({ granted: true }).expect(403).expect((r) => expect(r.body.key).toBeTruthy());
  });

  it('RC-01 uploads: encrypted at rest via the local storage adapter, download round-trips, type/size/magic checks, delete removes the file', async () => {
    const up = await c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: '../evil/lab.pdf', mimeType: 'application/pdf', contentBase64: PDF.toString('base64'), title: 'My blood test' }).expect(201);
    expect(up.body).toMatchObject({ kind: 'UPLOAD', source: 'PATIENT', hasFile: true, mimeType: 'application/pdf', sizeBytes: PDF.length, title: 'My blood test' });
    expect(up.body.fileName).not.toContain('/');
    const row = await c.prisma.sharedRecord.findUniqueOrThrow({ where: { id: up.body.id } });
    const onDisk = readFileSync(join('.data/test-vault', row.storageKey!));
    expect(onDisk.includes(Buffer.from('patient-private-content'))).toBe(false); // ciphertext only
    const dl = await c.http().get(`/api/v1/me/vault/${up.body.id}/content`).set(auth).expect(200);
    expect(Buffer.from(dl.body).equals(PDF)).toBe(true);
    await c.http().get(`/api/v1/me/vault/${up.body.id}/content`).set(await c.as('sub_other')).expect(404);
    await c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: 'x.exe', mimeType: 'application/x-msdownload', contentBase64: 'AAAA' }).expect(400).expect((r) => expect(r.body.code).toBe('UNSUPPORTED_FILE_TYPE'));
    await c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: 'x.pdf', mimeType: 'application/pdf', contentBase64: Buffer.from('not a pdf at all').toString('base64') }).expect(400).expect((r) => expect(r.body.code).toBe('MIME_MISMATCH'));
    process.env.VAULT_MAX_BYTES = '100';
    await c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: 'x.pdf', mimeType: 'application/pdf', contentBase64: PDF.toString('base64') }).expect(400).expect((r) => expect(r.body.code).toBe('FILE_TOO_LARGE'));
    await c.http().delete(`/api/v1/me/vault/${up.body.id}`).set(auth).expect(200);
    expect(existsSync(join('.data/test-vault', row.storageKey!))).toBe(false);
    expect((await c.http().get('/api/v1/me/vault').set(auth)).body.items).toHaveLength(0);
  });

  it('RC-01 large (3 MB) upload passes the body limit while webhook raw-body HMAC still works', async () => {
    const big = Buffer.concat([Buffer.from('%PDF-1.4\n'), Buffer.alloc(3 * 1024 * 1024, 7)]);
    await c.http().post('/api/v1/me/vault/uploads').set(auth).send({ fileName: 'big.pdf', mimeType: 'application/pdf', contentBase64: big.toString('base64') }).expect(201);
    expect((await share()).status).toBe(200);
  });

  it('RC-03 follow-up reminders: doctor interval from the share, patient-set, consent-gated delivery, cancel, revoked record cancels them', async () => {
    await share(summary('enc_f', { followUp: { intervalDays: 14 } }));
    const fu = (await c.http().get('/api/v1/me/follow-ups').set(auth)).body;
    expect(fu).toHaveLength(1);
    expect(fu[0]).toMatchObject({ source: 'DOCTOR', status: 'SCHEDULED' });
    expect(Math.round((new Date(fu[0].dueAt).getTime() - new Date('2026-11-18T10:00:00Z').getTime()) / 86400_000)).toBe(14);
    const recId = (await c.http().get('/api/v1/me/vault').set(auth)).body.items.find((i: any) => i.kind === 'VISIT_SUMMARY').id;
    const mine = await c.http().post('/api/v1/me/follow-ups').set(auth).send({ afterDays: 7, recordId: recId }).expect(201);
    expect(mine.body).toMatchObject({ source: 'PATIENT', recordId: recId });
    await c.http().post('/api/v1/me/follow-ups').set(auth).send({ afterDays: 0 }).expect(400);
    await c.http().post('/api/v1/me/follow-ups').set(auth).send({ afterDays: 3, recordId: 'kx_rec_nope' }).expect(404);
    const msg = await c.prisma.message.findFirstOrThrow({ where: { bookingId: mine.body.id, channel: 'WHATSAPP' } });
    expect(msg).toMatchObject({ status: 'SCHEDULED', templateId: 'TODO_NEEDS_HUMAN_follow_up_due' });
    // delivery at the due date respects REMINDERS consent
    await c.prisma.message.update({ where: { id: msg.id }, data: { scheduledFor: new Date(Date.now() - 1000) } });
    await c.get(EngagementService).processDue();
    expect((await c.prisma.message.findUniqueOrThrow({ where: { id: msg.id } })).status).toBe('SKIPPED_CONSENT');
    await c.http().delete(`/api/v1/me/follow-ups/${mine.body.id}`).set(auth).expect(200);
    await c.http().delete(`/api/v1/me/follow-ups/${mine.body.id}`).set(auth).expect(404);
    await c.http().delete(`/api/v1/me/vault/${recId}`).set(auth).expect(200);
    expect((await c.http().get('/api/v1/me/follow-ups').set(auth)).body).toEqual([]);
  });

  it('LabResultReleased lands in the vault as a secure link (no values); export includes the vault; account deletion purges it', async () => {
    const ev = { reportId: 'rep_1', orderId: 'ord_1', labId: 'lab_1', patientRef: 'pat_1', reportVersion: 1, signedAt: '2026-11-19T09:00:00.000Z', secureLink: 'https://lab.example.test/r/abc', channels: ['KIOREX_VAULT'] };
    expect((await c.webhook('LabResultReleased', ev, { aggregateType: 'LabReport', aggregateId: 'rep_1' })).status).toBe(200);
    const items = (await c.http().get('/api/v1/me/vault?kind=LAB_RESULT').set(auth)).body.items;
    expect(items).toHaveLength(1);
    const d = (await c.http().get(`/api/v1/me/vault/${items[0].id}`).set(auth)).body;
    expect(d.report.secureLink).toBe(ev.secureLink);
    expect(JSON.stringify(d)).not.toMatch(/"values"|"results"/);
    const exp = (await c.http().post('/api/v1/me/export').set(auth)).body;
    expect(exp.vault).toHaveLength(1);
    await c.http().post('/api/v1/me/deletion').set(auth).send({ confirm: true }).expect(200);
    expect(await c.prisma.sharedRecord.count({ where: { status: 'ACTIVE' } })).toBe(0);
  });
});
