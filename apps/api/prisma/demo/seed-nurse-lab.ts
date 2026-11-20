/**
 * Kiorex side of the KNLAB01 demo hand-offs (Kiorly Nurse sample -> Kiorly Lab -> result back), synthetic, DEV/STAGING ONLY.
 * Spec: prisma/demo/demo-nurse-lab.json (byte-identical in clinics-management and kiorly-lab). Runs at the end of seed-demo.ts, after the Kiorly
 * clinic seed (ClinicalOrder + LabSampleCollection, labStatus HANDED_OFF) and the Kiorly Lab seed (the KIORLY_NURSE orders, advanced to `labTarget`).
 *
 * Kiorex is the relay, so this seed does what the relay would have done, with the same data it would hold:
 *   1. a NurseLabRelay row per hand-off (SUBMITTED / RESULT_RELEASED / REFUSED), the lab order id + number taken from the Lab seed's hand-off
 *      (DEMO_HANDOFF_FILE locally, DEMO_HANDOFF_JSON on AWS; falls back to asking the Lab over the signed KIORLY_NURSE partner API),
 *   2. the lab status / sanitized custody / report link pushed back to the clinic through the real signed endpoint
 *      `POST /marketplace/v1/lab-orders/:orderId/status` (monotonic + idempotent, so re-runs are harmless).
 * If the Lab or the clinic is not reachable (e.g. AWS isolated subnets without an egress path, HB07) the relay rows are still written and the push is skipped with a warning.
 */
import { PrismaClient } from '@prisma/client';
import { PARTNER_DEV_DEFAULTS, signKiorlyRequest } from '@kiorex/contracts';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

type Order = { key: string; id: string; tenant: string; patient: { phone: string; ref: string }; labTarget: string; refusalCode?: string };
type Handoff = Record<string, { labOrderId?: string; orderNumber?: string; status?: string; reportId?: string; version?: number; secureLink?: string; signedAt?: string; state?: string }>;
type Custody = { orderNumber?: string; specimens?: { label: string; custody: { type: string; occurredAt: string; by: 'NURSE' | 'LAB'; temperatureC?: number | null }[] }[] };

const LADDER = ['ACCEPTED', 'COLLECTED', 'IN_LAB', 'AWAITING_VALIDATION', 'VALIDATED', 'RELEASED'];
const TARGET_RUNG: Record<string, string> = { RELEASED: 'RELEASED', AWAITING_VALIDATION: 'AWAITING_VALIDATION', IN_TRANSIT: 'COLLECTED' };

function readHandoff(): Handoff {
  try {
    const json = process.env.DEMO_HANDOFF_JSON;
    if (json) { const j = JSON.parse(json); return (j.nurseLab ?? j) as Handoff; }
    const file = process.env.DEMO_HANDOFF_FILE;
    if (file && existsSync(file)) return (JSON.parse(readFileSync(file, 'utf8')).nurseLab ?? {}) as Handoff;
  } catch (e) { console.warn('nurse-lab: could not read the Lab hand-off:', (e as Error).message); }
  return {};
}

async function labGet(path: string): Promise<any | null> {
  const d = PARTNER_DEV_DEFAULTS.labNurse; const base = process.env.LAB_BASE_URL ?? d.baseUrl; const full = `/api/v1/integration/v1${path}`;
  try {
    const s = signKiorlyRequest({ clientKey: process.env.LAB_NURSE_CLIENT_KEY ?? d.clientKey, clientSecret: process.env.LAB_NURSE_CLIENT_SECRET ?? d.clientSecret, method: 'GET', path: full, body: '' } as any);
    const r = await fetch(base + full, { headers: s.headers as any, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function pushToClinic(orderId: string, body: Record<string, unknown>): Promise<string> {
  const base = (process.env.KIORLY_BASE_URL ?? 'http://localhost:3010/marketplace/v1').replace(/\/$/, '');
  const url = `${base}/lab-orders/${encodeURIComponent(orderId)}/status`; const payload = JSON.stringify(body);
  const s = signKiorlyRequest({ clientKey: process.env.KIORLY_CLIENT_KEY ?? 'kx_dev_client', clientSecret: process.env.KIORLY_CLIENT_SECRET ?? 'kx_dev_secret_change_me', method: 'POST', path: new URL(url).pathname, body: payload } as any);
  try {
    const r = await fetch(url, { method: 'POST', headers: { ...(s.headers as any), 'content-type': 'application/json' }, body: payload, signal: AbortSignal.timeout(8000) });
    return r.ok ? 'ok' : `HTTP ${r.status}`;
  } catch (e) { return `unreachable (${(e as Error).message})`; }
}

export async function seedNurseLab(prisma: PrismaClient): Promise<string> {
  const spec = JSON.parse(readFileSync(join(__dirname, 'demo-nurse-lab.json'), 'utf8')) as { orders: Order[] };
  const home = JSON.parse(readFileSync(join(__dirname, 'demo-home-visits.json'), 'utf8')) as { providers: Record<string, { nameEn: string; tenant: string }> };
  const providerOfTenant = (tenant: string) => Object.values(home.providers).find((p) => p.tenant === tenant)?.nameEn;
  const handoff = readHandoff();
  const out: string[] = [];
  for (const o of spec.orders) {
    const name = providerOfTenant(o.tenant); const prov = name ? await prisma.provider.findFirst({ where: { nameEn: name, status: 'LIVE' } }) : null;
    if (!prov) { out.push(`${o.key}: provider not synced`); continue; }
    if (o.labTarget === 'REFUSED') {
      await prisma.nurseLabRelay.upsert({ where: { id: o.id }, update: {}, create: { id: o.id, clinicId: prov.clinicId, patientRef: o.patient.ref, status: 'REFUSED', refusalCode: o.refusalCode ?? 'REFUSED' } });
      out.push(`${o.key}: REFUSED relay, clinic push ${await pushToClinic(o.id, { status: 'REJECTED_BY_LAB', rejectionCode: o.refusalCode ?? 'REFUSED', occurredAt: new Date().toISOString() })}`);
      continue;
    }
    const h = handoff[o.id] ?? {};
    const lab = h.labOrderId ? null : await labGet(`/orders/${encodeURIComponent(o.id)}`);
    const labOrderId = h.labOrderId ?? lab?.id; const orderNumber = h.orderNumber ?? lab?.orderNumber;
    if (!labOrderId) { out.push(`${o.key}: lab order missing (run the Lab demo seed first)`); continue; }
    const released = o.labTarget === 'RELEASED';
    await prisma.nurseLabRelay.upsert({
      where: { id: o.id }, update: {},
      create: { id: o.id, clinicId: prov.clinicId, patientRef: o.patient.ref, partnerOrderId: labOrderId, labOrderNumber: orderNumber, status: released ? 'RESULT_RELEASED' : 'SUBMITTED', lastLabStatus: TARGET_RUNG[o.labTarget] ?? h.status, reportId: released ? h.reportId ?? null : null },
    });
    const c = (await labGet(`/orders/${encodeURIComponent(o.id)}/custody`)) as Custody | null;
    const custody = (c?.specimens ?? []).flatMap((s) => s.custody.map((e) => ({ label: s.label, type: e.type, occurredAt: e.occurredAt, by: e.by, temperatureC: e.temperatureC ?? null })));
    const rungs = LADDER.slice(0, LADDER.indexOf(TARGET_RUNG[o.labTarget] ?? 'ACCEPTED') + 1);
    let last = 'n/a';
    for (const status of rungs) {
      const body: Record<string, unknown> = { status, labOrderNumber: orderNumber, occurredAt: new Date().toISOString(), ...(status === 'ACCEPTED' ? {} : { custody }) };
      if (status === 'RELEASED') { if (!h.reportId) { out.push(`${o.key}: report id unknown (re-run with --reset)`); break; } Object.assign(body, { reportId: h.reportId, reportVersion: h.version ?? 1, secureLink: h.secureLink ?? `https://lab.invalid/demo-report/${h.reportId}`, signedAt: h.signedAt ?? new Date().toISOString() }); }
      last = await pushToClinic(o.id, body);
      if (last !== 'ok') break;
    }
    out.push(`${o.key}: ${o.labTarget}, clinic push ${last}`);
  }
  return out.join('; ');
}
