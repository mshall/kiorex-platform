import { parseCsv } from './csv';
import { parseSqlDump } from './sql-parser';
import { decodeText, repairMojibake } from './encoding';
import { normalizePhone, parseDate, parseNationalId, nameKey } from './normalize';
import { scanUpload, MockMalwareScanner } from './file-scan';
import { analyze, type Decision, type SourceTable, type StagedFile } from './analyzer';
import { buildSample } from '../sample/sample-data';
import { createHash } from 'node:crypto';

const scanner = new MockMalwareScanner();
async function stage(decisions: Decision[] = []) {
  const s = buildSample(); const sql = parseSqlDump(s.sql.toString('utf8'));
  const tables: SourceTable[] = sql.tables.map((table) => ({ fileId: 'f_sql', table }));
  const files: StagedFile[] = []; let i = 0;
  for (const f of s.files) { const v = await scanUpload(f.name, f.bytes, scanner); files.push({ fileId: `f${i++}`, name: f.name, sha256: createHash('sha256').update(f.bytes).digest('hex'), size: f.bytes.length, kind: v.ok ? 'PATIENT_FILE' : 'REJECTED' }); }
  return { sql, run: (d: Decision[]) => analyze({ tables, files, decisions: d, unsafe: sql.dangerous, now: new Date('2026-11-23') }), s };
}

describe('sql parser (static, never executes)', () => {
  it('reads inserts, escapes, create-table column lists and flags dangerous statements', () => {
    const r = parseSqlDump(buildSample().sql.toString('utf8'));
    expect(r.dialect).toBe('mysql');
    const p = r.tables.find((t) => t.name === 'tbl_patients')!;
    expect(p.rows).toHaveLength(15); expect(p.columns[0]).toBe('pat_id');
    expect(p.rows[9].pname).toBe("Omar Farouk O'Neil");
    expect(p.rows[5].mobile).toBe(''); expect(p.rows[2].nat_no).toBeNull();
    expect(r.tables.find((t) => t.name === 'exam')!.rows).toHaveLength(4); // no column list -> from CREATE TABLE
    expect(r.dangerous).toEqual(expect.arrayContaining(['DROP TABLE', 'GRANT ALL']));
  });
  it('handles postgres COPY blocks', () => {
    const r = parseSqlDump('CREATE TABLE patients (id int, name text);\nCOPY public.patients (id, name) FROM stdin;\n1\tAmal\n2\t\\N\n\\.\n');
    expect(r.tables[0].rows).toEqual([{ id: '1', name: 'Amal' }, { id: '2', name: null }]);
  });
});
describe('csv + encoding + normalisation', () => {
  it('csv quotes, delimiter detection, BOM', () => { const t = parseCsv('﻿name;phone\n"A; B";0100\nC;\n'); expect(t.rows).toEqual([{ name: 'A; B', phone: '0100' }, { name: 'C', phone: null }]); });
  it('decodes windows-1256 and repairs double-encoded UTF-8', () => {
    expect(decodeText(Buffer.from([0xc7, 0xe1, 0xd3, 0xe1, 0xc7, 0xe3])).encoding).toBe('windows-1256');
    expect(repairMojibake(Buffer.from('أحمد', 'utf8').toString('latin1'))).toBe('أحمد');
  });
  it('phones, dates, national ids', () => {
    expect(normalizePhone('٠١٠١٢٣٤٥٦٧٨')).toMatchObject({ value: '+201012345678', valid: true });
    expect(normalizePhone('012345').valid).toBe(false);
    expect(parseDate('03/04/1990')).toMatchObject({ value: '1990-04-03', ambiguous: true, alt: '1990-03-04' });
    expect(parseDate('1992-02-30').valid).toBe(false); expect(parseDate('31/12/2000').ambiguous).toBeUndefined();
    expect(parseNationalId('29004031201234')).toMatchObject({ valid: true, dob: '1990-04-03' });
    expect(nameKey('أَحْمَد  إبراهيم')).toBe(nameKey('احمد ابراهيم'));
  });
});
describe('quarantine scan', () => {
  it('rejects malware, disguised executables, active pdf, bad types', async () => {
    const s = buildSample();
    expect(await scanUpload(s.extras.malware.name, s.extras.malware.bytes, scanner)).toMatchObject({ ok: false, reason: 'MALWARE' });
    expect(await scanUpload(s.extras.disguisedExe.name, s.extras.disguisedExe.bytes, scanner)).toMatchObject({ ok: false, reason: 'TYPE_NOT_ALLOWED' });
    expect(await scanUpload('x.pdf', Buffer.from('%PDF-1.4 /JavaScript (app.alert)'), scanner)).toMatchObject({ ok: false, reason: 'ACTIVE_CONTENT' });
    expect(await scanUpload('x.png', Buffer.from('%PDF-1.4 x'), scanner)).toMatchObject({ ok: false, reason: 'MIME_MISMATCH' });
    expect(await scanUpload('x.exe', Buffer.from('MZ00'), scanner)).toMatchObject({ ok: false });
    expect(await scanUpload('a.sql', Buffer.from('select 1;'), scanner)).toMatchObject({ ok: true, cls: 'SQL' });
  });
});
describe('analyzer', () => {
  it('classifies tables, maps columns, and raises the expected human tasks', async () => {
    const { run } = await stage(); const a = run([]);
    const cls = Object.fromEntries(a.classification.map((c) => [c.table, c.entity]));
    expect(cls).toMatchObject({ tbl_patients: 'patients', appts: 'appointments', exam: 'visits', inv: 'billing', cities: null });
    expect(a.mappings.patients.find((m) => m.field === 'phone')!.column).toBe('mobile');
    expect(a.mappings.patients.find((m) => m.field === 'sourceId')!.column).toBe('pat_id');
    const types = new Set(a.tasks.map((t) => t.type));
    for (const t of ['DUPLICATE_PATIENT', 'MISSING_REQUIRED', 'INVALID_VALUE', 'AMBIGUOUS_DATE', 'ENCODING_PROBLEM', 'ORPHAN_REFERENCE', 'ORPHAN_FILE', 'TABLE_UNCLASSIFIED', 'SQL_UNSAFE_STATEMENTS']) expect(types).toContain(t);
    expect(a.stats.blockers).toBeGreaterThan(0);
    expect(a.tasks.find((t) => t.type === 'DUPLICATE_PATIENT')!.context.members).toHaveLength(2);
  });
  it('matches files by id, national id, phone; never silently guesses ambiguous ones', async () => {
    const { run } = await stage(); const first = run([]);
    const a = run([{ taskKey: first.tasks.find((t) => t.type === 'DUPLICATE_PATIENT')!.key, action: 'MERGE', params: { keep: '1001' } }]);
    const via = (name: string) => { const f = a.fileLinks.find((l) => a.records.documents.find((d) => d.data.fileId === l.fileId)?.data.fileName === name); return f ? `${f.patientSourceKey}:${f.via}` : null; };
    expect(via('P1001_xray_chest.pdf')).toBe('1001:ID'); expect(via('29004031201234_idcard.jpg')).toMatch(/NATIONAL_ID/); expect(via('01012345678_prescription.pdf')).toMatch(/PHONE/);
    expect(via('IMG_0001.jpg')).toBeNull();
    // before the duplicate is merged, a file addressed by that national id is AMBIGUOUS, never silently assigned
    expect(first.tasks.some((t) => t.type === 'AMBIGUOUS_FILE')).toBe(true);
    expect(a.tasks.some((t) => t.type === 'AMBIGUOUS_FILE' || t.type === 'ORPHAN_FILE')).toBe(true);
  });
  it('decisions resolve tasks idempotently and unblock the batch', async () => {
    const { run } = await stage(); let a = run([]);
    const d: Decision[] = [];
    const by = (t: string) => a.tasks.filter((x) => x.type === t && x.status === 'OPEN');
    d.push({ taskKey: by('DUPLICATE_PATIENT')[0].key, action: 'MERGE', params: { keep: '1001' } });
    a = run(d);
    for (const t of a.tasks.filter((x) => x.status === 'OPEN' && x.severity === 'BLOCKER')) {
      if (t.type === 'MISSING_REQUIRED' && t.ref?.field === 'fullName') d.push({ taskKey: `skip:patients:${t.ref.sourceKey}`, action: 'SKIP_ROW' });
      else if (t.type === 'MISSING_REQUIRED' || t.type === 'INVALID_VALUE') d.push({ taskKey: t.key, action: 'EDIT_VALUE', params: { value: t.ref?.field === 'phone' ? '01099990000' : t.ref?.field === 'amount' ? '100' : '2026-01-01' } });
      else if (t.type === 'ORPHAN_REFERENCE') d.push({ taskKey: `skip:${t.entity}:${t.ref!.sourceKey}`, action: 'SKIP_ROW' });
      else if (t.type === 'ORPHAN_FILE' || t.type === 'AMBIGUOUS_FILE') d.push({ taskKey: t.key, action: 'SKIP_FILE' });
    }
    a = run(d); const again = run(d);
    expect(again.stats).toEqual(a.stats);
    for (let round = 0; round < 3 && a.stats.blockers; round++) { // second-order tasks (e.g. files that became ambiguous)
      for (const t of a.tasks.filter((x) => x.status === 'OPEN' && x.severity === 'BLOCKER')) d.push({ taskKey: t.type.includes('FILE') ? t.key : `skip:${t.entity}:${t.ref?.sourceKey}`, action: t.type.includes('FILE') ? 'SKIP_FILE' : 'SKIP_ROW' });
      a = run(d);
    }
    expect(a.tasks.filter((x) => x.status === 'OPEN' && x.severity === 'BLOCKER').map((x) => x.type + ':' + x.key)).toEqual([]);
    expect(a.records.patients.map((p) => p.sourceKey)).not.toContain('1008'); // merged into 1001
    expect(a.stats.mergedPatients).toBe(1);
    expect(a.records.patients.find((p) => p.sourceKey === '1002')!.data.phone).toBe('+201123456789');
  });
  it('an edit that is still invalid keeps the task open', async () => {
    const { run } = await stage(); const a = run([]); const t = a.tasks.find((x) => x.type === 'INVALID_VALUE' && x.ref?.field === 'phone')!;
    const b = run([{ taskKey: t.key, action: 'EDIT_VALUE', params: { value: '123' } }]);
    expect(b.tasks.find((x) => x.key === t.key)!.status).toBe('OPEN');
  });
});
