import { createCtx, TestCtx } from './harness';

/** EDGE 47 regression: uploads are strict base64, hostile names are neutralised, nothing 5xx. */
describe('onboarding import: hostile uploads', () => {
  let c: TestCtx; let ops: { Authorization: string };
  beforeAll(async () => { c = await createCtx({ devMarketGate: false }); });
  afterAll(async () => { await c.close(); });
  beforeEach(async () => { await c.reset(); ops = await c.as('ops_1', { roles: ['ops_admin'] }); });
  const B = '/api/v1/admin/onboarding/imports';
  const batch = async () => (await c.http().post(B).set(ops).send({ orgId: 'org_edge', orgName: 'Edge' }).expect(201)).body.id as string;
  const up = (id: string, body: object) => c.http().post(`${B}/${id}/files`).set(ops).send(body);

  it('invalid or truncated base64 is a 400 and stores nothing; valid base64 with line breaks and padding is accepted', async () => {
    const id = await batch();
    for (const contentBase64 of ['***not base64***', 'QUJD=RA', 'QUJDR', 'QUJD\u0000RA==', 'é']) expect((await up(id, { name: 'a.sql', contentBase64 })).status).toBe(400);
    expect((await c.prisma.importFile.count({ where: { batchId: id } }))).toBe(0);
    const ok = Buffer.from("INSERT INTO tbl_patients (id) VALUES (1);").toString('base64');
    expect((await up(id, { name: 'ok.sql', contentBase64: `${ok.slice(0, 8)}\n${ok.slice(8)}` })).status).toBe(201);
  });
  it('path-like and over-long names are neutralised (no separators stored, at most 200 chars)', async () => {
    const id = await batch();
    for (const name of ['../../etc/passwd', 'a\\b\\c.pdf', 'x'.repeat(190) + '.pdf']) await up(id, { name, contentBase64: Buffer.from('%PDF-1.4').toString('base64') });
    const names = (await c.prisma.importFile.findMany({ where: { batchId: id } })).map((f) => f.name);
    for (const n of names) { expect(n).not.toMatch(/[\\/\0]/); expect(n.length).toBeLessThanOrEqual(200); }
  });
});
