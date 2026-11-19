/**
 * Kiorex platform DEMO / QA dataset (synthetic, DEV ONLY — see /TEST_DATA.md).
 *
 *   npm run db:seed:demo -w apps/api              idempotent (deterministic ids, upserts / skipDuplicates)
 *   npm run db:seed:demo -w apps/api -- --reset   first deletes ONLY demo rows (ids/subs prefixed demo_ / 01HZKXD / kx_*_demo_), then re-creates
 *
 * Prerequisites (seed-all.sh does this in order): Passport demo accounts, Kiorly Clinic demo seed (appointments `demo_mk_*`),
 * and a provider sync (`POST /admin/providers/sync?full=true`) so the demo doctors exist as Providers.
 * Bookings mirror the Kiorly appointments created from prisma/demo/demo-marketplace-bookings.json (same keys), so provider sync,
 * reconciliation and webhooks stay consistent. Money rows follow the real ledger postings (capture / fee / release / refund / payout).
 * Gate evidence is recorded ONLY as DEV-ONLY-NOT-A-REAL-GATE in this dev DB so the verticals are visible; never in production.
 */
import 'reflect-metadata';
import { PrismaClient } from '@prisma/client';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { signKiorlyRequest, PARTNER_DEV_DEFAULTS } from '@kiorex/contracts';
import { FlagsService } from '../../src/control-plane/flags.service';
import { OutboxService } from '../../src/outbox/outbox.service';
import { encryptField } from '../../src/common/crypto';
import { capture, pspFee, refundRequest, refundSettle, release, payout, type Posting } from '../../src/pay/ledger';

if (process.env.NODE_ENV === 'production') throw new Error('refusing to seed demo data in production');
const prisma = new PrismaClient({ datasourceUrl: process.env.DATABASE_URL ?? 'postgresql://postgres:postgres@127.0.0.1:5433/kiorex_platform?schema=public' });
const RESET = process.argv.includes('--reset');
const DAY = 86_400_000;
const today0 = new Date(); today0.setUTCHours(0, 0, 0, 0);
const at = (off: number, hour = 9, min = 0) => new Date(today0.getTime() + off * DAY + hour * 3_600_000 + min * 60_000);
const sub = (n: number) => `01HZKXD${String(n).padStart(19, '0')}`;
const phone = (n: number) => `+20100000${String(n).padStart(4, '0')}`;
async function many(model: string, rows: any[]) { if (rows.length) await (prisma as any)[model].createMany({ data: rows, skipDuplicates: true }); }

const PERSONAS: [number, string, string, 'F' | 'M', string, 'ar' | 'en'][] = [
  [1001, 'Hoda Mahmoud', 'هدى محمود', 'F', '1989-03-14', 'ar'], [1002, 'Samir Ali Nassar', 'سمير علي نصار', 'M', '1986-07-02', 'ar'],
  [1003, 'Karim Mostafa', 'كريم مصطفى', 'M', '1984-11-21', 'en'], [1004, 'Nourhan Fathy', 'نورهان فتحي', 'F', '1995-01-30', 'ar'],
  [1005, 'Mahmoud El-Sayed', 'محمود السيد', 'M', '1972-05-09', 'ar'], [1006, 'Mariam Adel', 'مريم عادل', 'F', '1993-09-17', 'en'],
  [1007, 'Omar Hegazy', 'عمر حجازي', 'M', '1997-12-03', 'en'], [1008, 'Dalia Ibrahim', 'داليا إبراهيم', 'F', '1988-04-25', 'ar'],
  [1009, 'Tarek Zaki', 'طارق زكي', 'M', '1990-08-11', 'en'], [1010, 'Heba Salah', 'هبة صلاح', 'F', '1991-02-19', 'ar'],
  [1011, 'Youssef Ramadan', 'يوسف رمضان', 'M', '2000-06-06', 'en'], [1012, 'Rana Khaled', 'رنا خالد', 'F', '1985-10-28', 'ar'],
];

async function partnerGet(kind: 'pharmacy' | 'lab', path: string): Promise<any | null> {
  const d = PARTNER_DEV_DEFAULTS[kind]; const full = kind === 'lab' ? `/api/v1${path}` : path;
  try {
    const s = signKiorlyRequest({ clientKey: d.clientKey, clientSecret: d.clientSecret, method: 'GET', path: full, body: '' } as any);
    const r = await fetch(d.baseUrl + full, { headers: s.headers as any, signal: AbortSignal.timeout(8000) });
    return r.ok ? await r.json() : null;
  } catch { return null; }
}

async function resetDemo() {
  const bk = `(SELECT id FROM "BookingIntent" WHERE id LIKE 'demo_bk_%')`;
  const pay = `(SELECT id FROM "PaymentIntent" WHERE id LIKE 'demo_pay_%' OR id LIKE 'demo_vpay_%')`;
  const subs = `sub LIKE '01HZKXD%'`;
  const sql = [
    `DELETE FROM "LedgerEntry" WHERE "txId" IN (SELECT id FROM "LedgerTx" WHERE "idempotencyKey" LIKE 'demo:%')`,
    `DELETE FROM "LedgerTx" WHERE "idempotencyKey" LIKE 'demo:%'`,
    `DELETE FROM "Refund" WHERE id LIKE 'demo_rf_%'`, `DELETE FROM "Payout" WHERE id LIKE 'demo_po_%'`,
    `DELETE FROM "PaymentIntent" WHERE id LIKE 'demo_pay_%' OR id LIKE 'demo_vpay_%'`,
    `DELETE FROM "Review" WHERE "bookingId" IN ${bk}`, `DELETE FROM "TeleSession" WHERE "bookingId" IN ${bk}`,
    `DELETE FROM "BookingEvent" WHERE "bookingId" IN ${bk}`, `DELETE FROM "Message" WHERE id LIKE 'demo_msg_%'`, `DELETE FROM "MessageLog" WHERE id LIKE 'demo_ml_%'`,
    `DELETE FROM "WaitlistOffer" WHERE id LIKE 'demo_wo_%'`, `DELETE FROM "WaitlistEntry" WHERE id LIKE 'demo_wl_%'`,
    `DELETE FROM "BookingIntent" WHERE id LIKE 'demo_bk_%'`,
    `DELETE FROM "SharedRecord" WHERE id LIKE 'demo_rec_%'`, `DELETE FROM "RecordShareConsent" WHERE ${subs}`, `DELETE FROM "FollowUpReminder" WHERE id LIKE 'demo_fu_%'`,
    `DELETE FROM "PharmacyOrder" WHERE id LIKE 'kx_ph_demo_%'`, `DELETE FROM "LabBooking" WHERE id LIKE 'kx_lb_demo_%'`,
    `DELETE FROM "KiorlyPatientLink" WHERE ${subs}`, `DELETE FROM "Dependant" WHERE id LIKE 'demo_dep_%'`, `DELETE FROM "ConsentRecord" WHERE ${subs}`,
    `DELETE FROM "PatientProfile" WHERE ${subs}`,
  ];
  for (const s of sql) { try { await prisma.$executeRawUnsafe(s); } catch (e: any) { console.warn('reset step skipped:', s.slice(0, 50), String(e.message).slice(0, 100)); } }
  console.log('kiorex demo: reset demo rows');
}

async function main() {
  process.env.JOBS_ENABLED = 'false';
  if (RESET) await resetDemo();

  // ── flag registry: a few non-default values + DEV-ONLY gate evidence so launch-locked verticals are visible ──
  const flags = new FlagsService(prisma as never, new OutboxService(prisma as never));
  await flags.seed({ devKeys: true });
  const gate = async (key: string) => {
    const have = await prisma.flagGateEvidence.findFirst({ where: { flagKey: key, gateId: 'DEV-ONLY-NOT-A-REAL-GATE' } });
    if (!have) await flags.recordGate('DEMO_SEED', key, { gateId: 'DEV-ONLY-NOT-A-REAL-GATE', approver: 'DEMO SEED (not a human approval)', approvedOn: new Date(), documentUrl: 'https://dev.invalid/demo-seed-not-evidence' }).catch((e) => console.warn('gate', key, e.message));
  };
  for (const k of ['kiorex.telemedicine', 'kiorex.pharmacy_orders', 'kiorex.lab_bookings', 'kiorex.ai_navigation', 'clinic.specialty_templates.cardiology', 'clinic.specialty_templates.paediatrics', 'clinic.specialty_templates.dermatology']) await gate(k);
  const set = (key: string, scope: 'GLOBAL' | 'MARKET' | 'ORG', scopeId: string | undefined, value: 'ON' | 'OFF', reason: string) =>
    flags.setValue('DEMO_SEED', { key, scope, scopeId, value, reason: `DEV demo: ${reason}`, ticket: 'DEMO-FLAGS' } as any).catch((e) => console.warn('flag', key, e.message));
  await set('kiorex.telemedicine', 'GLOBAL', undefined, 'ON', 'telemedicine visible (mock video)');
  await set('kiorex.whatsapp_booking', 'GLOBAL', undefined, 'OFF', 'WhatsApp booking channel switched off (non-default example)');
  await set('kiorex.sponsored_listings', 'MARKET', 'EG', 'OFF', 'no sponsored listings in Egypt yet');
  await set('clinic.kiorex_listing', 'ORG', 'demo_t_ss', 'OFF', 'Smile & Skin Studio is on trial: listing off (ORG scope example)');
  await set('lab.module', 'ORG', 'demo_lab_example', 'OFF', 'ORG-scope example row');

  // ── patient profiles, dependants, Kiorly links, consents ──
  const bookingsSpec = JSON.parse(readFileSync(join(__dirname, 'demo-marketplace-bookings.json'), 'utf8')).bookings as any[];
  const providers = await prisma.provider.findMany({ where: { id: { startsWith: 'demo_l_' } } });
  const byName = new Map(providers.map((p) => [p.nameEn, p]));
  if (!providers.length) throw new Error('no demo providers: run Kiorly demo seed + POST /admin/providers/sync?full=true first');
  for (const [n, en, ar, g, dob, loc] of PERSONAS) {
    const s = sub(n);
    await prisma.patientProfile.upsert({ where: { sub: s }, create: { sub: s, phone: phone(n), nameEn: en, nameAr: ar, gender: g, dateOfBirth: new Date(dob), preferredLocale: loc, market: 'EG', email: `patient${n}@demo.kiorex.test` }, update: { nameEn: en, nameAr: ar } });
    await prisma.consentRecord.createMany({ data: [{ id: `demo_cr_${n}_1`, sub: s, purpose: 'MARKETPLACE', granted: true, version: 'v1', source: 'WEB' }, { id: `demo_cr_${n}_2`, sub: s, purpose: 'REMINDERS', granted: n % 5 !== 0, version: 'v1', source: 'WEB' }], skipDuplicates: true }).catch(() => {});
    await prisma.kiorlyPatientLink.createMany({ data: [{ id: `demo_kl_${n}`, sub: s, clinicId: 'demo_c_na_maadi', kiorlyPatientId: `demo_p_na_${n - 1000}`, evidence: 'PHONE_MATCH', status: 'LINKED' }], skipDuplicates: true }).catch(() => {});
  }
  const deps: [string, number, string, string, number, string][] = [['demo_dep_1', 1001, 'Yassin Samir Ali', 'ياسين سمير علي', 8, 'son'], ['demo_dep_2', 1001, 'Laila Samir Ali', 'ليلى سمير علي', 4, 'daughter'], ['demo_dep_3', 1003, 'Salma Karim Mostafa', 'سلمى كريم مصطفى', 15, 'daughter'], ['demo_dep_4', 1005, 'Adam Mahmoud El-Sayed', 'آدم محمود السيد', 2, 'son']];
  await many('dependant', deps.map(([id, g, en, ar, age, rel]) => ({ id, guardianSub: sub(g), nameEn: en, nameAr: ar, dateOfBirth: new Date(Date.UTC(2026 - age, 5, 1)), relationship: rel, evidence: 'self_declared', gender: rel === 'son' ? 'M' : 'F' })));

  // ── bookings mirrored from Kiorly (same keys) + payments + ledger ──
  const clinicPay = new Map<string, number>();
  let postN = 0;
  async function post(key: string, kind: string, postings: Posting[], extra: { bookingId?: string; paymentId?: string; clinicId?: string }) {
    if (await prisma.ledgerTx.findUnique({ where: { idempotencyKey: `demo:${key}` } })) return;
    await prisma.ledgerTx.create({ data: { idempotencyKey: `demo:${key}`, kind, ...extra, createdAt: at(0), entries: { create: postings.map((p) => ({ account: p.account, debitMinor: p.debit, creditMinor: p.credit })) } } as any });
    postN++;
  }
  const typeOf = (p: any) => `demo_ty_${p.id.split('_')[2]}_${p.clinicId.split('_').slice(3).join('_')}_consult`;
  const completed: { b: any; spec: any; p: any }[] = [];
  const statusCounts: Record<string, number> = {};
  for (const s of bookingsSpec) {
    const p = byName.get(s.doctorNameEn); if (!p) continue;
    const n = Number(s.patientPhone.slice(-4)); const id = `demo_bk_${s.key}`;
    const startsAt = at(s.dayOffset, s.hourUtc); const fee = p.minFeeMinor ? Math.round((p.maxFeeMinor ?? p.minFeeMinor)) : 40000;
    const dep = s.deposit !== 'NONE'; const depMinor = dep ? 15000 : 0;
    const stage = s.kiorexStatus; statusCounts[stage] = (statusCounts[stage] ?? 0) + 1;
    const createdAt = new Date(Math.min(startsAt.getTime(), Date.now()) - 5 * DAY);
    await prisma.bookingIntent.upsert({
      where: { id }, update: {},
      create: { id, sub: sub(n), providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: typeOf(p), startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60000), status: stage, channel: 'MARKETPLACE', kiorlyAppointmentId: `demo_mk_${s.key}`, kiorlyPatientId: `demo_p_na_${n - 1000}`, currency: 'EGP', feeMinor: fee, depositStatus: s.deposit, depositAmountMinor: depMinor, depositRefundable: s.deposit === 'REFUNDED', holdExternalRef: `${id}:hold`, holdExpiresAt: stage === 'HELD' ? at(0, 23) : null, cancelledBy: stage === 'CANCELLED' ? (s.key.length % 2 ? 'PATIENT' : 'CLINIC') : null, cancellationReason: stage === 'CANCELLED' ? 'Demo cancellation' : null, patientSnapshot: { forDependant: false, demo: true } as any, createdAt, terminalAt: ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(stage) ? startsAt : null, version: 1 } as any,
    });
    const evs = [['INTENT', null, 'INTENT'], ['HOLD', 'INTENT', 'HELD'], ['KIORLY_CALL', 'HELD', 'CONFIRMED'], ['WEBHOOK', 'CONFIRMED', stage]].slice(0, stage === 'HELD' ? 2 : stage === 'PENDING_CLINIC' ? 3 : 4);
    await many('bookingEvent', evs.map(([kind, from, to], i) => ({ id: `${id}_ev${i}`, bookingId: id, kind, fromStatus: from, toStatus: to, detail: { demo: true } as any, createdAt: new Date(createdAt.getTime() + i * 60000) })));
    // deposit payment + ledger
    if (dep) {
      const pid = `demo_pay_${s.key}`; const fee2 = Math.round(depMinor * 0.02);
      const st = ({ REQUIRED: 'CREATED', PAID: 'CAPTURED', RELEASED: 'CAPTURED', FORFEITED: 'CAPTURED', REFUNDED: 'REFUNDED' } as any)[s.deposit];
      await prisma.paymentIntent.upsert({ where: { id: pid }, update: {}, create: { id: pid, bookingId: id, sub: sub(n), clinicId: p.clinicId, amountMinor: depMinor, currency: 'EGP', psp: 'sandbox-fake', pspRef: `fake_${s.key}`, status: st, refundedMinor: s.deposit === 'REFUNDED' ? depMinor : 0, feeMinor: st === 'CREATED' ? 0 : fee2, purpose: 'DEPOSIT', capturedAt: st === 'CREATED' ? null : createdAt, releasedAt: ['RELEASED', 'FORFEITED'].includes(s.deposit) ? startsAt : null, releaseKind: s.deposit === 'RELEASED' ? 'COMPLETED' : s.deposit === 'FORFEITED' ? 'FORFEITED' : null, checkoutUrl: `http://localhost:4000/api/v1/pay/fake-checkout/${pid}` } as any });
      if (st !== 'CREATED') {
        await post(`cap:${pid}`, 'CAPTURE', capture(p.clinicId, depMinor), { bookingId: id, paymentId: pid, clinicId: p.clinicId });
        await post(`fee:${pid}`, 'PSP_FEE', pspFee(fee2), { paymentId: pid, clinicId: p.clinicId });
      }
      if (['RELEASED', 'FORFEITED'].includes(s.deposit)) { await post(`rel:${pid}`, `RELEASE_${s.deposit === 'RELEASED' ? 'COMPLETED' : 'FORFEITED'}`, release(p.clinicId, depMinor), { bookingId: id, paymentId: pid, clinicId: p.clinicId }); clinicPay.set(p.clinicId, (clinicPay.get(p.clinicId) ?? 0) + depMinor); }
      if (s.deposit === 'REFUNDED') {
        const rid = `demo_rf_${s.key}`;
        await prisma.refund.upsert({ where: { id: rid }, update: {}, create: { id: rid, paymentId: pid, amountMinor: depMinor, reason: 'CLINIC_CANCELLED', idempotencyKey: `demo:${rid}`, status: 'SETTLED', pspRefundRef: `fake_rf_${s.key}`, settledAt: startsAt } as any });
        await post(`rfr:${rid}`, 'REFUND_REQUEST', refundRequest(p.clinicId, depMinor), { bookingId: id, paymentId: pid, clinicId: p.clinicId });
        await post(`rfs:${rid}`, 'REFUND_SETTLED', refundSettle(depMinor), { bookingId: id, paymentId: pid, clinicId: p.clinicId });
      }
    }
    if (stage === 'COMPLETED') completed.push({ b: { id, sub: sub(n), n }, spec: s, p });
  }
  // payouts (one per clinic for the released deposits)
  let poN = 0;
  for (const [clinicId, amt] of clinicPay) {
    const id = `demo_po_${++poN}`; const key = `${new Date().getUTCFullYear()}-W${String(Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / (7 * DAY))).padStart(2, '0')}`;
    if (await prisma.payout.findUnique({ where: { id } })) continue;
    await prisma.payout.create({ data: { id, payoutRef: `demo-payout-${poN}`, clinicId, amountMinor: amt, periodKey: key, paymentRefs: [] as any, status: poN % 2 ? 'KIORLY_RECORDED' : 'SENT', paidAt: at(-2) } as any });
    await post(`po:${id}`, 'PAYOUT', payout(clinicId, amt), { clinicId });
  }

  // ── reviews with replies, vault records, follow-ups ──
  const REV = [[5, 'Excellent doctor, very patient with my child. Clean clinic.', 'دكتورة ممتازة وصبورة جدا مع ابني. العيادة نظيفة.', 'Thank you for your kind words, see you at the next visit!'], [4, 'Good consultation, waited 20 minutes.', 'كشف جيد لكن انتظرت ٢٠ دقيقة.', null], [5, 'Clear explanation and fair price.', 'شرح واضح وسعر مناسب.', 'We appreciate your trust.'], [3, 'Doctor was good but front desk was slow.', 'الدكتور ممتاز لكن الاستقبال بطيء.', 'Sorry about the wait, we are improving our front desk.'], [5, 'Very professional, solved my problem in one visit.', 'محترف جدا وحل مشكلتي من أول زيارة.', null], [2, 'Visit was rushed.', 'الكشف كان سريع جدا.', null]];
  const rated = new Map<string, number[]>();
  for (const [i, c] of completed.entries()) {
    const r = REV[i % REV.length]; const rid = `demo_rv_${c.spec.key}`;
    if (i % 4 === 3) continue; // some visits have no review yet (shows the review invitation state)
    await prisma.review.createMany({ data: [{ id: rid, bookingId: c.b.id, sub: c.b.sub, providerId: c.p.id, clinicId: c.p.clinicId, clinicianId: c.p.clinicianId, kiorlyAppointmentId: `demo_mk_${c.spec.key}`, rating: r[0] as number, text: (i % 2 ? r[2] : r[1]) as string, status: i === 5 ? 'HIDDEN' : 'VISIBLE', moderationFlags: i === 5 ? ['demo_flagged'] as any : [] as any, clinicReply: r[3] as string | null, syncStatus: 'SYNCED', editableUntil: at(-1), createdAt: at(c.spec.dayOffset + 1) } as any], skipDuplicates: true });
    if (i !== 5) rated.set(c.p.id, [...(rated.get(c.p.id) ?? []), r[0] as number]);
  }
  for (const [pid, rs] of rated) await prisma.provider.update({ where: { id: pid }, data: { ratingAvg: Math.round((rs.reduce((a, b) => a + b, 0) / rs.length) * 10) / 10, ratingCount: rs.length } as any });

  const rxItems = [{ drugName: 'Amoxicillin/clavulanate 625mg', dosage: '1 tab', frequency: 'BID', duration: '7 days' }, { drugName: 'Paracetamol 500mg', dosage: '1 tab', frequency: 'q6h PRN', duration: '3 days' }];
  const recs: any[] = []; const fus: any[] = [];
  for (const [i, c] of completed.entries()) {
    const signedAt = at(c.spec.dayOffset, c.spec.hourUtc + 1); const base = { sub: c.b.sub, clinicId: c.p.clinicId, kiorlyPatientId: `demo_p_na_${c.b.n - 1000}`, signedAt, status: 'ACTIVE', createdAt: signedAt, sourceEventId: `demo_ev_${c.spec.key}` };
    recs.push({ id: `demo_rec_${c.spec.key}_v`, kind: 'VISIT_SUMMARY', sourceRef: `demo_en_${c.spec.key}`, title: `Visit summary — ${c.p.nameEn}`, payloadEnc: encryptField(JSON.stringify({ encounterId: `demo_en_${c.spec.key}`, summary: 'Demo visit summary: assessment and plan shared by the clinic.', doctor: c.p.nameEn })), ...base });
    if (i % 2 === 0) recs.push({ id: `demo_rec_${c.spec.key}_rx`, kind: 'PRESCRIPTION', sourceRef: `demo_rx_${c.spec.key}`, title: `Prescription — ${c.p.nameEn}`, payloadEnc: encryptField(JSON.stringify({ encounterId: `demo_en_${c.spec.key}`, items: rxItems })), ...base });
    if (i % 3 === 0) fus.push({ id: `demo_fu_${c.spec.key}`, sub: c.b.sub, recordId: `demo_rec_${c.spec.key}_v`, clinicId: c.p.clinicId, dueAt: at(7 + i), source: 'DOCTOR', status: 'SCHEDULED' });
  }
  recs.push({ id: 'demo_rec_upload_1', sub: sub(1005), kind: 'UPLOAD', title: 'ECG report (uploaded by patient)', fileName: 'ecg-demo.pdf', mimeType: 'application/pdf', sizeBytes: 48211, status: 'ACTIVE', createdAt: at(-9) });
  await many('sharedRecord', recs); await many('followUpReminder', fus);
  for (const [n] of PERSONAS) await many('recordShareConsent', [{ sub: sub(n), scope: 'VISIT_SUMMARY', granted: true }, { sub: sub(n), scope: 'PRESCRIPTIONS', granted: n % 4 !== 0 }, { sub: sub(n), scope: 'LAB_RESULTS', granted: true }, { sub: sub(n), scope: 'SHARE_WITH_OTHER_CLINICS', granted: n % 3 === 0 }]).catch(() => {});

  // ── waitlist entries/offers, telemedicine, messaging ──
  const wlP = [byName.get('Dr Tamer Shawky'), byName.get('Dr Nadia Fouad'), byName.get('Dr Walid Samy'), byName.get('Dr Rania Abdelaziz')].filter(Boolean) as any[];
  const WL = ['WAITING', 'OFFERED', 'BOOKED', 'WAITING', 'EXPIRED', 'CANCELLED'];
  await many('waitlistEntry', WL.map((st, i) => { const p = wlP[i % wlP.length]; return { id: `demo_wl_${i}`, sub: sub(1001 + i), providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: typeOf(p), preferredFrom: at(1), preferredTo: at(10), status: st, expiresAt: at(i === 4 ? -2 : 20) }; }));
  await many('waitlistOffer', [1, 2].map((i) => { const p = wlP[i % wlP.length]; return { id: `demo_wo_${i}`, entryId: `demo_wl_${i}`, sub: sub(1001 + i), providerId: p.id, startsAt: at(3, 10), endsAt: at(3, 10, 30), expiresAt: at(i === 1 ? 1 : -1), status: i === 1 ? 'OFFERED' : 'ACCEPTED', respondedAt: i === 1 ? null : at(-1) }; }));
  const confirmedTele = bookingsSpec.filter((s) => s.kiorexStatus === 'CONFIRMED' && byName.get(s.doctorNameEn)).slice(0, 2);
  const doneTele = bookingsSpec.filter((s) => s.kiorexStatus === 'COMPLETED' && byName.get(s.doctorNameEn)).slice(0, 1);
  await many('teleSession', [...confirmedTele.map((s, i) => ({ s, st: i ? 'SCHEDULED' : 'WAITING' })), ...doneTele.map((s) => ({ s, st: 'ENDED' }))].map(({ s, st }) => { const p = byName.get(s.doctorNameEn)!; const start = at(s.dayOffset, s.hourUtc); return { id: `demo_ts_${s.key}`, sub: sub(Number(s.patientPhone.slice(-4))), bookingId: `demo_bk_${s.key}`, providerId: p.id, clinicId: p.clinicId, roomName: `demo-room-${s.key}`, scheduledStartsAt: start, status: st, videoProvider: 'mock', consultFeeMinor: 30000, ...(st === 'ENDED' ? { startedAt: start, endedAt: new Date(start.getTime() + 18 * 60000), durationSec: 1080, patientJoinedAt: start, clinicianJoinedAt: start } : {}) }; }));
  const msgs: any[] = []; const logs: any[] = [];
  bookingsSpec.slice(0, 18).forEach((s, i) => {
    const st = (['SENT', 'DELIVERED', 'READ', 'FAILED', 'QUEUED'] as const)[i % 5]; const tpl = i % 2 ? 'booking.reminder' : 'booking.confirmed'; const ch = i % 3 === 0 ? 'EMAIL' : 'WHATSAPP';
    msgs.push({ id: `demo_msg_${i}`, sub: sub(Number(s.patientPhone.slice(-4))), bookingId: `demo_bk_${s.key}`, channel: ch, templateId: tpl, locale: i % 2 ? 'ar' : 'en', status: st === 'QUEUED' ? 'SCHEDULED' : 'SENT', sentAt: at(-(i % 7), 8), dedupeKey: `demo:${s.key}:${tpl}` });
    logs.push({ id: `demo_ml_${i}`, messageId: `demo_msg_${i}`, channel: ch, direction: 'OUTBOUND', mode: 'mock', sub: sub(Number(s.patientPhone.slice(-4))), recipient: s.patientPhone, recipientMasked: `${s.patientPhone.slice(0, 6)}****${s.patientPhone.slice(-2)}`, templateId: tpl, locale: i % 2 ? 'ar' : 'en', body: `[DEMO mock] ${tpl} for ${s.doctorNameEn}`, status: st, error: st === 'FAILED' ? 'DEMO mock: simulated provider failure' : null, createdAt: at(-(i % 7), 8), sentAt: st !== 'QUEUED' ? at(-(i % 7), 8) : null, deliveredAt: ['DELIVERED', 'READ'].includes(st) ? at(-(i % 7), 8, 1) : null, readAt: st === 'READ' ? at(-(i % 7), 8, 9) : null, failedAt: st === 'FAILED' ? at(-(i % 7), 8, 1) : null });
  });
  await many('message', msgs).catch((e) => console.warn('messages:', String(e.message).slice(0, 120)));
  await many('messageLog', logs).catch((e) => console.warn('messageLog:', String(e.message).slice(0, 120)));

  // ── pharmacy / lab orders against the REAL partner catalogues (partner seeds mirror these ids) ──
  let ph = 0, lb = 0;
  const pharmacies = await partnerGet('pharmacy', '/marketplace/v1/pharmacies'); const cat = pharmacies?.items?.[0] ? await partnerGet('pharmacy', `/marketplace/v1/catalogue?pharmacyId=${pharmacies.items[0].id}`) : null;
  const items: any[] = (cat?.items ?? []).filter((i: any) => !i.name?.startsWith('E2E') && !i.rxRequired).slice(0, 12);
  if (pharmacies?.items?.[0] && items.length >= 4) {
    const rxRec = recs.find((r) => r.kind === 'PRESCRIPTION'); const PH = ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'READY', 'DISPENSED', 'DISPENSED', 'REJECTED', 'CANCELLED'];
    for (const [i, st] of PH.entries()) {
      const lines = [items[i % items.length], items[(i + 3) % items.length]].map((x) => ({ sku: x.sku, name: x.name, qty: 1 + (i % 2), unitMinor: x.priceMinor }));
      const sub1 = lines.reduce((a, l) => a + l.qty * l.unitMinor, 0); const rx = lines.some((_, k) => items[(i + (k ? 3 : 0)) % items.length].rxRequired);
      await prisma.pharmacyOrder.upsert({ where: { id: `kx_ph_demo_${i + 1}` }, update: {}, create: { id: `kx_ph_demo_${i + 1}`, sub: sub(1001 + (i % 8)), pharmacyId: pharmacies.items[0].id, status: st, items: lines as any, subtotalMinor: sub1, totalMinor: sub1, deliveryMethod: i % 2 ? 'DELIVERY' : 'PICKUP', deliveryFeeMinor: 0, currency: 'EGP', deliveryAddress: i % 2 ? ({ line1: '12 Demo Street', city: 'Cairo' } as any) : undefined, rxStatus: rx ? (st === 'REJECTED' ? 'INVALID' : 'VALID') : 'NOT_REQUIRED', prescriptionRecordId: rx ? rxRec?.id : undefined, partnerOrderId: ['SUBMITTED', 'READY', 'DISPENSED', 'REJECTED'].includes(st) ? `ph_ord_demo_${i + 1}` : undefined, takeRateBps: 500, platformFeeMinor: Math.round(sub1 * 0.05), rejectionReason: st === 'REJECTED' ? 'Prescription could not be validated (DEMO)' : undefined, readyAt: ['READY', 'DISPENSED'].includes(st) ? at(-i) : undefined, dispensedAt: st === 'DISPENSED' ? at(-i, 12) : undefined, createdAt: at(-i - 1) } as any }); ph++;
    }
  } else console.warn('pharmacy partner not reachable / empty catalogue: skipped pharmacy orders');
  const labs = await partnerGet('lab', '/integration/v1/labs'); const tests = labs?.items?.[0] ? await partnerGet('lab', '/integration/v1/tests') : null;
  const tl: any[] = (tests?.items ?? []).filter((t: any) => !String(t.name).startsWith('E2E')).slice(0, 10);
  if (labs?.items?.[0] && tl.length >= 3) {
    const LB = ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'COLLECTED', 'RESULT_RELEASED', 'RESULT_RELEASED', 'REJECTED', 'CANCELLED'];
    for (const [i, st] of LB.entries()) {
      const ts = [tl[i % tl.length], tl[(i + 2) % tl.length]].map((t) => ({ code: t.code, name: t.name, priceMinor: t.priceMinor })); const subt = ts.reduce((a, t) => a + t.priceMinor, 0);
      await prisma.labBooking.upsert({ where: { id: `kx_lb_demo_${i + 1}` }, update: {}, create: { id: `kx_lb_demo_${i + 1}`, sub: sub(1004 + (i % 8)), labId: labs.items[0].id, tests: ts as any, collectionType: i % 2 ? 'HOME' : 'LAB_VISIT', slotStartsAt: at(i - 3, 8), slotEndsAt: at(i - 3, 9), status: st, subtotalMinor: subt, totalMinor: subt, collectionFeeMinor: 0, currency: 'EGP', partnerOrderId: ['SUBMITTED', 'COLLECTED', 'RESULT_RELEASED'].includes(st) ? `lab_ord_demo_${i + 1}` : undefined, takeRateBps: 500, platformFeeMinor: Math.round(subt * 0.05), rejectionReason: st === 'REJECTED' ? 'Slot unavailable (DEMO)' : undefined, createdAt: at(i - 5) } as any }); lb++;
    }
  } else console.warn('lab partner not reachable / empty catalogue: skipped lab bookings');

  console.log(`Kiorex demo seed OK — ${PERSONAS.length} patient profiles, ${deps.length} dependants, ${bookingsSpec.length} bookings (${Object.entries(statusCounts).map(([k, v]) => `${k}:${v}`).join(' ')}), ${postN} ledger txs, ${completed.length} completed visits, ${recs.length} vault records, ${ph} pharmacy orders, ${lb} lab bookings`);
  await prisma.$disconnect();
}
main().catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
