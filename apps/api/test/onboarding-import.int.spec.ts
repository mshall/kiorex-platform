import { Logger } from '@nestjs/common';
import { createCtx, TestCtx } from './harness';
import { MockImportTarget } from '../src/onboarding-import/adapters';
import { buildSample } from '../src/onboarding-import/sample/sample-data';

describe('organization onboarding / data import (ops)', () => {
  let c: TestCtx; let ops: { Authorization: string }; let sa1: { Authorization: string }; let sa2: { Authorization: string }; let patient: { Authorization: string };
  const logs: string[] = [];
  beforeAll(async () => {
    c = await createCtx({ devMarketGate: false });
    for (const m of ['log', 'warn', 'error', 'debug', 'verbose'] as const) jest.spyOn(Logger.prototype, m).mockImplementation((...a: unknown[]) => { logs.push(a.map(String).join(' ')); });
  });
  afterAll(async () => { jest.restoreAllMocks(); await c.close(); });
  beforeEach(async () => {
    await c.reset(); logs.length = 0;
    ops = await c.as('ops_1', { roles: ['ops_admin'] }); sa1 = await c.as('sa_1', { roles: ['ops_admin', 'super_admin'] }); sa2 = await c.as('sa_2', { roles: ['ops_admin', 'super_admin'] }); patient = await c.as('p_1', { roles: ['patient'] });
  });
  const B = '/api/v1/admin/onboarding/imports';
  const post = (h: any, p: string, body?: object) => c.http().post(`${B}${p}`).set(h).send(body ?? {});
  const get = (h: any, p = '') => c.http().get(`${B}${p}`).set(h);
  const up = (h: any, id: string, name: string, bytes: Buffer) => post(h, `/${id}/files`, { name, contentBase64: bytes.toString('base64') });

  async function stageSample(h = ops) {
    const id = (await post(h, '', { orgId: 'org_new_1', orgName: 'Al-Noor Clinic (test)' }).expect(201)).body.id as string;
    const s = buildSample();
    await up(h, id, 'clinicpro_dump.sql', s.sql).expect(201);
    for (const f of s.files) await up(h, id, f.name, f.bytes).expect(201);
    return { id, s };
  }
  async function resolveAll(h: any, id: string) {
    for (let round = 0; round < 8; round++) {
      const open = (await get(h, `/${id}/tasks?status=OPEN&pageSize=200`)).body.items as any[];
      const blockers = open.filter((t) => t.severity === 'BLOCKER'); if (!blockers.length) break;
      for (const t of blockers) {
        let body: any;
        if (t.type === 'DUPLICATE_PATIENT') body = { action: 'MERGE', params: { keep: '1001' } };
        else if (t.type === 'MISSING_REQUIRED' && t.ref.field === 'fullName') body = { action: 'SKIP_ROW' };
        else if (t.type === 'MISSING_REQUIRED' || t.type === 'INVALID_VALUE') body = { action: 'EDIT_VALUE', params: { value: t.ref.field === 'phone' ? '01099990000' : t.ref.field === 'amount' ? '100' : '2026-01-01' } };
        else if (t.type === 'ORPHAN_REFERENCE') body = { action: 'SKIP_ROW' };
        else if (t.type === 'ORPHAN_FILE' || t.type === 'AMBIGUOUS_FILE') body = t.context.name === 'scan_unknown.pdf' ? { action: 'ASSIGN_FILE', params: { sourceKey: '1014' } } : { action: 'SKIP_FILE' };
        else throw new Error(`unhandled blocker ${t.type}`);
        const r = await post(h, `/${id}/tasks/${t.id}/resolve`, body); expect([200, 404]).toContain(r.status); // 404 = the task vanished because an earlier resolution in this round already fixed it
      }
    }
  }

  it('is ops-only; approval/commit/rollback are super-admin-only', async () => {
    await get(patient).expect(403);
    const { id } = await stageSample();
    await post(ops, `/${id}/approve`, { reportHash: 'x' }).expect(403);
    await post(ops, `/${id}/commit`).expect(403);
    await post(ops, `/${id}/rollback`, { reason: 'test' }).expect(403);
  });

  it('quarantines + scans: malware, disguised executables and duplicates never reach staging rows; SQL is parsed, never executed', async () => {
    const { id, s } = await stageSample();
    expect((await up(ops, id, s.extras.malware.name, s.extras.malware.bytes).expect(201)).body).toMatchObject({ kind: 'REJECTED', rejectReason: 'MALWARE' });
    expect((await up(ops, id, s.extras.disguisedExe.name, s.extras.disguisedExe.bytes).expect(201)).body).toMatchObject({ kind: 'REJECTED', rejectReason: 'TYPE_NOT_ALLOWED' });
    await up(ops, id, s.extras.duplicateOfFirst.name, s.extras.duplicateOfFirst.bytes).expect(201);
    const tasks = (await get(ops, `/${id}/tasks?pageSize=200`)).body.items as any[];
    expect(tasks.filter((t) => t.type === 'FILE_REJECTED')).toHaveLength(2);
    expect(tasks.some((t) => t.type === 'DUPLICATE_FILE')).toBe(true);
    expect(tasks.find((t) => t.type === 'SQL_UNSAFE_STATEMENTS').context.statements.length).toBeGreaterThan(0);
    expect(await c.prisma.patientProfile.count()).toBe(0); // nothing outside the staging tables
    const b = (await get(ops, `/${id}`)).body;
    expect(b.status).toBe('NEEDS_REVIEW');
    expect(b.summary.classification.find((x: any) => x.table === 'tbl_patients').entity).toBe('patients');
  });

  it('end to end: resolve → dry-run → two-person approval → crash-resumable idempotent commit → rollback; PHI never reaches logs or audit', async () => {
    const { id } = await stageSample();
    const open0 = (await get(ops, `/${id}/tasks?status=OPEN&pageSize=200`)).body;
    expect(open0.items.some((t: any) => t.type === 'DUPLICATE_PATIENT')).toBe(true);
    // cannot commit while blockers are open
    await post(ops, `/${id}/request-commit`).expect(409);
    // the orphan-file picker + bad action are validated
    const dup = open0.items.find((t: any) => t.type === 'DUPLICATE_PATIENT');
    await post(ops, `/${id}/tasks/${dup.id}/resolve`, { action: 'EDIT_VALUE', params: { value: 'x' } }).expect(400);
    const ign = open0.items.find((t: any) => t.actions.includes('IGNORE'));
    await post(ops, `/${id}/tasks/${ign.id}/resolve`, { action: 'IGNORE' }).expect(400); // reason mandatory
    await post(ops, `/${id}/tasks/${ign.id}/resolve`, { action: 'IGNORE', reason: 'not needed for onboarding' }).expect(200);

    await resolveAll(ops, id);
    const ready = (await get(ops, `/${id}`)).body; expect(ready.status).toBe('READY');
    const dry = (await get(ops, `/${id}/dry-run`)).body;
    expect(dry).toMatchObject({ canCommit: true, openBlockers: 0, targetMode: 'mock', mergedPatients: 1 });
    expect(dry.willCreate.patients).toBe(13); expect(dry.willCreate.billing).toBeGreaterThan(0); expect(dry.filesToAttach).toBeGreaterThanOrEqual(14);

    // two-person rule
    await post(ops, `/${id}/request-commit`).expect(200);
    await post(ops, `/${id}/approve`, { reportHash: dry.reportHash }).expect(403); // ops_admin is not a super admin
    // a super admin who is the REQUESTER cannot approve their own request
    const id2 = (await post(sa1, '', { orgId: 'org_new_2', orgName: 'Second' }).expect(201)).body.id;
    await up(sa1, id2, 'a.csv', Buffer.from('id,name,phone\n1,Test Person,01012345678\n')).expect(201);
    const d2 = (await get(sa1, `/${id2}/dry-run`)).body; expect(d2.canCommit).toBe(true);
    await post(sa1, `/${id2}/request-commit`).expect(200);
    expect((await post(sa1, `/${id2}/approve`, { reportHash: d2.reportHash }).expect(403)).body.code).toBe('TWO_PERSON_RULE');

    // a decision change after the request invalidates it (report hash is pinned)
    const wrong = await post(sa1, `/${id}/approve`, { reportHash: 'deadbeef' }); expect(wrong.status).toBe(409);
    await post(sa1, `/${id}/approve`, { reportHash: dry.reportHash }).expect(200);
    expect((await get(ops, `/${id}`)).body.status).toBe('APPROVED');

    // commit crashes half-way → COMMIT_FAILED, resumable, no duplicates
    const target = c.get(MockImportTarget) as MockImportTarget; target.failAfter = 15; // all 13 patients land, then the first appointments chunk dies mid-way
    const fail = await post(sa2, `/${id}/commit`); expect(fail.status).toBe(409); expect(fail.body.code).toBe('COMMIT_FAILED_RESUMABLE');
    expect((await get(ops, `/${id}`)).body.status).toBe('COMMIT_FAILED');
    const partial = await c.prisma.importCommitItem.count({ where: { batchId: id } }); expect(partial).toBe(13); // chunk-level atomicity: the dead chunk is re-sent on resume and de-duplicated by idempotency key
    const ok = await post(sa2, `/${id}/commit`).expect(200);
    expect(ok.body.committed.patients).toBe(13);
    const items = await c.prisma.importCommitItem.findMany({ where: { batchId: id } });
    expect(new Set(items.map((i) => i.idempotencyKey)).size).toBe(items.length);
    expect(items.length).toBe(dry.willCreate.patients + dry.willCreate.appointments + dry.willCreate.visits + dry.willCreate.billing + dry.filesToAttach);
    expect((await get(ops, `/${id}`)).body.status).toBe('COMMITTED');
    await post(sa2, `/${id}/commit`).expect(409); // idempotent: cannot commit twice
    await post(ops, `/${id}/tasks/${ign.id}/resolve`, { action: 'IGNORE', reason: 'late change' }).expect(409); // locked

    // rollback
    await post(sa2, `/${id}/rollback`, { reason: '' }).expect(400);
    const rb = await post(sa2, `/${id}/rollback`, { reason: 'wrong clinic selected' }).expect(200);
    expect(rb.body.removed).toBeGreaterThan(0);
    expect((await get(ops, `/${id}`)).body.status).toBe('ROLLED_BACK');
    expect(await c.prisma.importCommitItem.count({ where: { batchId: id, status: 'COMMITTED' } })).toBe(0);
    await post(sa2, `/${id}/purge-staging`).expect(200);
    expect((await c.prisma.importFile.findMany({ where: { batchId: id } })).every((f) => f.tables === null)).toBe(true);

    // audit trail is complete and PHI-free
    const audit = (await get(ops, `/${id}/audit`)).body as any[];
    expect(audit.map((a) => a.action)).toEqual(expect.arrayContaining(['onboarding.batch_created', 'onboarding.file_staged', 'onboarding.task_resolved', 'onboarding.commit_requested', 'onboarding.commit_approved', 'onboarding.commit_failed', 'onboarding.commit_resumed', 'onboarding.commit_completed', 'onboarding.rollback_completed']));
    const blob = JSON.stringify(audit) + logs.join('\n');
    for (const phi of ['أحمد', 'Hassan Ali', '01012345678', '29004031201234', 'Omar Farouk', 'منى', 'xray_chest']) expect(blob).not.toContain(phi);
  });

  it('a data-changing decision after the approval request voids it (pinned report hash); a no-op ignore does not', async () => {
    const { id } = await stageSample(); await resolveAll(ops, id);
    await post(ops, `/${id}/request-commit`).expect(200);
    const open = (await get(ops, `/${id}/tasks?status=OPEN&severity=WARNING&pageSize=200`)).body.items as any[];
    const noop = open.find((t) => t.type === 'TABLE_UNCLASSIFIED');
    await post(ops, `/${id}/tasks/${noop.id}/resolve`, { action: 'IGNORE', reason: 'lookup table, not needed' }).expect(200);
    expect((await get(ops, `/${id}`)).body.status).toBe('AWAITING_APPROVAL');
    const amb = open.find((t) => t.type === 'AMBIGUOUS_DATE');
    await post(ops, `/${id}/tasks/${amb.id}/resolve`, { action: 'CHOOSE_DATE_FORMAT', params: { dayFirst: false } }).expect(200);
    const b = (await get(ops, `/${id}`)).body; expect(b.status).toBe('READY'); expect(b.requestedBy).toBeNull();
  });
});
