/**
 * Kiorex Rev 2.3 DEMO data: home bookings, address book, hold-for-review deposits, safety console feed, family shares, care-plan requests
 * (synthetic, DEV ONLY — see /TEST_DATA.md). Called at the end of seed-demo.ts (needs the Kiorly demo seed + provider sync first, so the
 * home-visit-enabled providers exist). Reads prisma/demo/demo-home-visits.json, mirrored byte-identical in clinics-management:
 * every origin=KIOREX visit exists there as appointment `demo_mk_<key>` (externalReference `demo_bk_<key>`) and here as booking `demo_bk_<key>`.
 *
 * Money rows follow the real ledger postings (capture, PSP fee, hold-for-review, review release / refund, refund settle). Gate evidence for the
 * home / physio / nurse flags is recorded ONLY as DEV-ONLY-NOT-A-REAL-GATE:<gate> (never a real approval). Nothing here talks to a provider.
 */
import { PrismaClient } from '../../src/prisma/generated/client';
import { readFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { join } from 'node:path';
import { FlagsService } from '../../src/control-plane/flags.service';
import { blindIndex, encryptField } from '../../src/common/crypto';
import { capture, holdForReview, pspFee, refundFromReview, refundRequest, refundSettle, release, releaseFromReview, type Posting } from '../../src/pay/ledger';

const MIN = 60_000;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');
const maskPhone = (p: string) => (p.length > 6 ? `${p.slice(0, 4)}****${p.slice(-3)}` : '***');

type Alert = { id: string; kind: string; raisedRel: number; kiorlyStatus: string; kiorexStatus: string };
type Visit = {
  key: string; provider: string; phone: string; addr?: string; svc: string; dependant?: string; t: { off?: number; hour?: number; rel?: number }; origin: string; appt: string; hv: string;
  assigned?: string | null; enRouteRel?: number; arrivedRel?: number; etaMinutes?: number; abortRel?: number; abortCategory?: string; cancelledBy?: string; heldRel?: number;
  kiorex?: { status: string; home: string | null }; deposit?: string; alerts?: Alert[];
};
type Addr = { key: string; label: string; labelAr: string; governorate: string; district: string; street: string; building?: string; floor?: string; flat?: string; landmark?: string; lat?: number; lng?: number; confirmed?: boolean; default?: boolean };
type Spec = {
  providers: Record<string, { nameEn: string; nameAr: string; tenant: string }>; addresses: Record<string, Addr[]>; visits: Visit[];
  carePlans: { key: string; provider: string; phone: string; addr: string; svc: string; title: string; startOff: number; count: number; hour: number; nurse: string; requestRef: string; kiorexStatus: string }[];
  carePlanRequests: { id: string; provider: string; phone: string; addr: string; svc: string; status: string; startOff: number }[];
};

const SVC: Record<string, { nameEn: string; dur: number }> = {
  injection: { nameEn: 'Injection', dur: 20 }, iv_cannula_infusion: { nameEn: 'IV cannula / infusion', dur: 45 }, wound_dressing: { nameEn: 'Wound dressing', dur: 30 },
  vitals_monitoring: { nameEn: 'Vitals monitoring', dur: 20 }, elderly_care_visit: { nameEn: 'Elderly-care visit', dur: 60 }, post_operative_care: { nameEn: 'Post-operative care', dur: 45 },
  doctor_home: { nameEn: 'Home visit', dur: 45 }, physio_home: { nameEn: 'Physio home session', dur: 45 },
};
const ASSIGNEE: Record<string, { displayName: string; badge: string; profession: string }> = {
  mona: { displayName: 'Mona A.', badge: 'Verified nurse', profession: 'NURSE' }, nurse1: { displayName: 'Heba N.', badge: 'Verified nurse', profession: 'NURSE' }, nurse2: { displayName: 'Salma N.', badge: 'Verified nurse', profession: 'NURSE' },
  mai: { displayName: 'Dr Mai H.', badge: 'Verified physiotherapist', profession: 'PHYSIOTHERAPIST' }, nadia: { displayName: 'Dr Nadia F.', badge: 'Verified physician', profession: 'PHYSICIAN' }, hany: { displayName: 'Dr Hany S.', badge: 'Verified physiotherapist', profession: 'PHYSIOTHERAPIST' },
};

export async function seedHome(prisma: PrismaClient, o: { at: (off: number, hour?: number, min?: number) => Date; sub: (n: number) => string; flags: FlagsService }): Promise<string> {
  const { at, sub, flags } = o;
  const now = process.env.DEMO_SEED_NOW ? new Date(process.env.DEMO_SEED_NOW) : new Date();
  const spec = JSON.parse(readFileSync(join(__dirname, 'demo-home-visits.json'), 'utf8')) as Spec;
  const many = async (model: string, rows: any[]) => { if (rows.length) await (prisma as any)[model].createMany({ data: rows, skipDuplicates: true }); };

  // ── dev gate evidence for the remaining Rev 2.3 launch-locked flags (GHV1/GHV2/GPR1 come from the base seed). DEV-ONLY-NOT-A-REAL-GATE:<gate> ──
  for (const [gate, keys] of [['GKN1', ['nurse.care_plans', 'nurse.mar']], ['GKN2', ['nurse.individual_kiorex_listing']], ['GPR2', ['clinic.specialty_templates.physio']], ['GHV1', ['clinic.home_visits', 'kiorex.home_visits']], ['GHV2', ['clinic.home_visits', 'kiorex.home_visits']], ['GPR1', ['kiorex.category.physiotherapy']]] as const) {
    for (const key of keys) {
      const gateId = `DEV-ONLY-NOT-A-REAL-GATE:${gate}`;
      if (await prisma.flagGateEvidence.findFirst({ where: { flagKey: key, gateId } })) continue;
      await flags.recordGate('DEMO_SEED', key, { gateId, approver: 'DEMO SEED (not a human approval)', approvedOn: new Date(), documentUrl: `https://dev.invalid/demo-seed-not-evidence-${gate}` }).catch((e) => console.warn('gate', key, gate, String(e.message).slice(0, 80)));
    }
  }

  // ── providers (synced from Kiorly) ──
  const prov: Record<string, any> = {};
  for (const [k, p] of Object.entries(spec.providers)) { const row = await prisma.provider.findFirst({ where: { nameEn: p.nameEn, status: 'LIVE' } }); if (row) prov[k] = row; else console.warn(`home seed: provider "${p.nameEn}" not synced (is clinic.home_visits effective in Kiorly? run provider sync)`); }
  if (!Object.keys(prov).length) return 'skipped: no home providers synced';
  const typeIdOf = (pk: string, svc: string): string | null => ((prov[pk]?.raw as any)?.provider?.fees ?? []).find((f: any) => f.nameEn === SVC[svc].nameEn)?.appointmentTypeId ?? null;
  const feeOf = (pk: string, svc: string) => ((prov[pk]?.raw as any)?.provider?.fees ?? []).find((f: any) => f.nameEn === SVC[svc].nameEn) as { amount: number; depositAmount: number | null; homeSurcharge?: number } | undefined;
  const kiorlyPatient = (pk: string, phone: string) => { const tk = spec.providers[pk].tenant; return tk === 'na' ? `demo_p_na_${Number(phone.slice(-4)) - 1000}` : `demo_p_${tk}_h${phone.slice(-4)}`; };
  const subOf = (phone: string) => sub(Number(phone.slice(-4)));

  // ── address book (encrypted street/building/floor/flat/landmark/pin) ──
  const addrRows: any[] = []; const addrId = (phone: string, key: string) => `kx_ad_demo_${phone.slice(-4)}_${key}`;
  for (const [phone, list] of Object.entries(spec.addresses)) {
    for (const a of list) {
      const lines = { street: a.street, building: a.building, floor: a.floor, flat: a.flat, landmark: a.landmark, lat: a.lat, lng: a.lng, pinSource: 'USER' };
      addrRows.push({ id: addrId(phone, a.key), sub: subOf(phone), label: a.label, governorate: a.governorate, district: a.district, addressEnc: encryptField(JSON.stringify(lines)), confirmedAt: a.confirmed ? new Date(now.getTime() - 40 * 86_400_000) : null, confirmedPhoneLast4: a.confirmed ? phone.slice(-4) : null, isDefault: !!a.default });
    }
  }
  // an unconfirmed address and a soft-deleted one so the address-book states are all visible
  addrRows.push({ id: 'kx_ad_demo_1001_new', sub: subOf('+201000001001'), label: 'Office (unconfirmed)', governorate: 'Cairo', district: 'zamalek', addressEnc: encryptField(JSON.stringify({ street: '2 Invented Office Park', building: 'T1', floor: '9', pinSource: 'USER', lat: 30.06, lng: 31.22 })), confirmedAt: null, isDefault: false });
  addrRows.push({ id: 'kx_ad_demo_1001_old', sub: subOf('+201000001001'), label: 'Old flat (deleted)', governorate: 'Giza', district: 'dokki', addressEnc: encryptField(JSON.stringify({ street: '1 Removed Street' })), confirmedAt: new Date(now.getTime() - 200 * 86_400_000), isDefault: false, deletedAt: new Date(now.getTime() - 30 * 86_400_000) });
  await many('patientAddress', addrRows);

  // ── bookings ──
  type B = Visit & { start: Date; end: Date; pid: string };
  const list: B[] = [];
  const mk = (v: Visit): B | null => {
    if (v.origin !== 'KIOREX' || !prov[v.provider] || !typeIdOf(v.provider, v.svc)) return null;
    const start = v.t.rel != null ? new Date(now.getTime() + v.t.rel * MIN) : at(v.t.off ?? 0, v.t.hour ?? 9);
    return { ...v, start, end: new Date(start.getTime() + SVC[v.svc].dur * MIN), pid: prov[v.provider].id };
  };
  const cpIds: Record<string, string> = {};
  for (const v of spec.visits) { const b = mk(v); if (b) list.push(b); }
  for (const c of spec.carePlans) {
    cpIds[c.key] = c.requestRef;
    for (let i = 0; i < c.count; i++) {
      const off = c.startOff + i; const past = off < 0;
      const b = mk({ key: `${c.key}_${i + 1}`, provider: c.provider, phone: c.phone, addr: c.addr, svc: c.svc, t: { off, hour: c.hour }, origin: 'KIOREX', appt: past ? 'COMPLETED' : 'CONFIRMED', hv: past ? 'FINISHED' : 'CONFIRMED', assigned: c.nurse, kiorex: { status: past ? 'COMPLETED' : 'CONFIRMED', home: past ? 'FINISHED' : 'ASSIGNED' }, deposit: 'NONE' });
      if (b) (b as any).carePlanId = c.requestRef, list.push(b);
    }
  }
  const post = async (key: string, kind: string, postings: Posting[], extra: { bookingId?: string; paymentId?: string; clinicId?: string }, at0: Date) => {
    if (await prisma.ledgerTx.findUnique({ where: { idempotencyKey: `demo:${key}` } })) return;
    await prisma.ledgerTx.create({ data: { idempotencyKey: `demo:${key}`, kind, ...extra, createdAt: at0, entries: { create: postings.map((p) => ({ account: p.account, debitMinor: p.debit, creditMinor: p.credit })) } } as any });
  };
  const counts: Record<string, number> = {}; let ledger = 0, pays = 0;
  for (const b of list) {
    const p = prov[b.provider]; const id = `demo_bk_${b.key}`; const fee = feeOf(b.provider, b.svc)!; const feeMinor = Math.round(fee.amount * 100); const surMinor = Math.round((fee.homeSurcharge ?? 0) * 100);
    const depMinor = b.deposit && b.deposit !== 'NONE' ? Math.round((fee.depositAmount ?? 100) * 100) : 0;
    const ks = b.kiorex?.status ?? 'CONFIRMED'; const home = b.kiorex?.home ?? null; counts[ks] = (counts[ks] ?? 0) + 1;
    const addr = (spec.addresses[b.phone] ?? []).find((a) => a.key === b.addr) ?? spec.addresses[b.phone]?.[0];
    const terminal = ['COMPLETED', 'CANCELLED', 'NO_SHOW'].includes(ks);
    const abortedAt = b.hv === 'ABORTED_UNSAFE' ? new Date(now.getTime() + (b.abortRel ?? -30) * MIN) : null;
    const terminalAt = abortedAt ?? (ks === 'COMPLETED' ? b.end : ks === 'CANCELLED' ? new Date(b.start.getTime() - 86_400_000) : ks === 'NO_SHOW' ? new Date(b.start.getTime() + 30 * MIN) : null);
    const enRouteAt = b.enRouteRel != null ? new Date(now.getTime() + b.enRouteRel * MIN) : ['ON_MY_WAY', 'ARRIVED', 'FINISHED'].includes(b.hv) ? new Date(b.start.getTime() - 25 * MIN) : null;
    const arrivedAt = b.arrivedRel != null ? new Date(now.getTime() + b.arrivedRel * MIN) : ['ARRIVED', 'FINISHED'].includes(b.hv) ? new Date(b.start.getTime() - 3 * MIN) : null;
    const created = new Date(Math.min(b.start.getTime(), now.getTime()) - 4 * 86_400_000);
    const assignee = b.assigned ? ASSIGNEE[b.assigned] : null;
    const abort = b.hv === 'ABORTED_UNSAFE';
    await prisma.bookingIntent.upsert({
      where: { id }, update: {},
      create: {
        id, sub: subOf(b.phone), dependantId: b.dependant ?? null, providerId: p.id, clinicId: p.clinicId, clinicianId: p.clinicianId, tenantId: p.tenantId, typeId: typeIdOf(b.provider, b.svc)!, startsAt: b.start, endsAt: b.end, status: ks, channel: 'MARKETPLACE',
        kiorlyAppointmentId: `demo_mk_${b.key}`, kiorlyPatientId: kiorlyPatient(b.provider, b.phone), currency: 'EGP', feeMinor, depositStatus: b.deposit === 'REVIEW_RELEASED' ? 'RELEASED' : b.deposit === 'REVIEW_REFUNDED' ? 'REFUNDED' : (b.deposit ?? 'NONE'), depositAmountMinor: depMinor,
        cancelledBy: abort ? 'SAFETY' : ks === 'CANCELLED' ? (b.cancelledBy ?? 'PATIENT') : null, cancellationReason: abort ? 'UNSAFE_ABORT' : ks === 'CANCELLED' ? (b.cancelledBy === 'CLINIC' ? 'Nurse unavailable' : 'Patient request') : null, depositRefundable: abort ? null : ks === 'CANCELLED' ? true : null,
        patientSnapshot: { demo: true }, createdAt: created, terminalAt, serviceLocation: 'HOME', careType: p.careType ?? 'DOCTORS', visitDistrict: addr?.district ?? null, homeState: home, homeSurchargeMinor: surMinor,
        assignee: assignee ?? undefined, enRouteAt, etaMinutes: b.etaMinutes ?? null, arrivedAt, abortedAt, carePlanId: (b as any).carePlanId ?? null,
      } as any,
    });
    const evs: [string, string | null, string][] = [['INTENT', null, 'INTENT'], ['HOLD', 'INTENT', 'HELD'], ['KIORLY_CALL', 'HELD', 'CONFIRMED']];
    if (ks === 'CHECKED_IN') evs.push(['WEBHOOK', 'CONFIRMED', 'CHECKED_IN']); if (ks === 'COMPLETED') evs.push(['WEBHOOK', 'CONFIRMED', 'CHECKED_IN'], ['WEBHOOK', 'CHECKED_IN', 'COMPLETED']); if (ks === 'CANCELLED') evs.push(['WEBHOOK', 'CONFIRMED', 'CANCELLED']); if (ks === 'NO_SHOW') evs.push(['WEBHOOK', 'CONFIRMED', 'NO_SHOW']);
    await many('bookingEvent', evs.map(([kind, from, to], i) => ({ id: `${id}_ev${i}`, bookingId: id, kind, fromStatus: from, toStatus: to, detail: { demo: true, home: true, ...(i === 2 && assignee ? { homeEvent: 'HOME_VISIT_ASSIGNED' } : {}) } as any, createdAt: new Date(created.getTime() + i * 60_000) })));
    // address snapshot (masked 24 h after the visit ended, like the real job)
    if (addr) {
      const lines = { street: addr.street, building: addr.building, floor: addr.floor, flat: addr.flat, landmark: addr.landmark, lat: addr.lat, lng: addr.lng, pinSource: 'USER' };
      const maskAfter = terminalAt ? new Date(terminalAt.getTime() + 24 * 3_600_000) : null; const masked = !!maskAfter && maskAfter <= now;
      await many('bookingVisitAddress', [{ bookingId: id, sub: subOf(b.phone), governorate: addr.governorate, district: addr.district, addressEnc: masked ? null : encryptField(JSON.stringify(lines)), maskAfter, maskedAt: masked ? maskAfter : null }]);
    }
    // deposit + ledger
    if (depMinor) {
      const pid = `demo_pay_${b.key}`; const fee2 = Math.round(depMinor * 0.02); const clinic = p.clinicId; const at0 = new Date(created.getTime() + 5 * MIN);
      const dep = b.deposit!;
      const refunded = ['REFUNDED', 'REVIEW_REFUNDED'].includes(dep); const held = dep === 'HOLD_FOR_REVIEW';
      const heldAt = b.heldRel != null ? new Date(now.getTime() + b.heldRel * MIN) : null;
      const rel = ['RELEASED', 'FORFEITED'].includes(dep) ? (dep === 'RELEASED' ? 'COMPLETED' : 'FORFEITED') : dep === 'REVIEW_RELEASED' ? 'REVIEW_RELEASED' : null;
      const reviewState = held ? 'HELD_FOR_REVIEW' : dep === 'REVIEW_RELEASED' ? 'RELEASED_TO_PROVIDER' : dep === 'REVIEW_REFUNDED' ? 'REFUNDED_TO_PATIENT' : null;
      await prisma.paymentIntent.upsert({
        where: { id: pid }, update: {},
        create: { id: pid, bookingId: id, sub: subOf(b.phone), clinicId: clinic, amountMinor: depMinor, currency: 'EGP', psp: 'sandbox-fake', pspRef: `fake_${b.key}`, status: refunded ? 'REFUNDED' : 'CAPTURED', refundedMinor: refunded ? depMinor : 0, feeMinor: fee2, purpose: 'DEPOSIT', capturedAt: at0, releasedAt: rel ? (terminalAt ?? now) : null, releaseKind: rel, kiorlyNotified: true, reviewState, reviewReason: reviewState ? 'UNSAFE_ABORT' : null, heldForReviewAt: reviewState ? heldAt : null, reviewedBy: reviewState && !held ? 'demo.ops.admin' : null, reviewedAt: reviewState && !held ? new Date((heldAt ?? now).getTime() + 3 * 3_600_000) : null, createdAt: created } as any,
      });
      pays++;
      await post(`cap:${pid}`, 'CAPTURE', capture(clinic, depMinor), { bookingId: id, paymentId: pid, clinicId: clinic }, at0); await post(`fee:${pid}`, 'PSP_FEE', pspFee(fee2), { paymentId: pid, clinicId: clinic }, at0); ledger += 2;
      if (rel === 'COMPLETED' || rel === 'FORFEITED') { await post(`rel:${pid}`, `RELEASE_${rel}`, release(clinic, depMinor), { bookingId: id, paymentId: pid, clinicId: clinic }, terminalAt ?? now); ledger++; }
      if (held || dep.startsWith('REVIEW_')) { await post(`hold-review:${pid}`, 'HOLD_FOR_REVIEW', holdForReview(clinic, depMinor), { bookingId: id, paymentId: pid, clinicId: clinic }, heldAt ?? now); ledger++; }
      if (dep === 'REVIEW_RELEASED') { await post(`review-release:${pid}`, 'REVIEW_RELEASE', releaseFromReview(clinic, depMinor), { bookingId: id, paymentId: pid, clinicId: clinic }, new Date((heldAt ?? now).getTime() + 3 * 3_600_000)); ledger++; }
      if (refunded) {
        const rid = `demo_rf_${b.key}`; const viaReview = dep === 'REVIEW_REFUNDED';
        await prisma.refund.upsert({ where: { id: rid }, update: {}, create: { id: rid, paymentId: pid, amountMinor: depMinor, reason: viaReview ? 'REVIEW:Reviewed by ops, refunded to patient (demo)' : b.cancelledBy === 'CLINIC' ? 'CLINIC_CANCELLED' : 'PATIENT_CANCELLED_REFUNDABLE', idempotencyKey: `demo:${rid}`, status: 'SETTLED', pspRefundRef: `fake_rf_${b.key}`, settledAt: terminalAt ?? now } as any });
        await post(`rfr:${rid}`, viaReview ? 'REVIEW_REFUND_REQUEST' : 'REFUND_REQUEST', viaReview ? refundFromReview(clinic, depMinor) : refundRequest(clinic, depMinor), { bookingId: id, paymentId: pid, clinicId: clinic }, terminalAt ?? now);
        await post(`rfs:${rid}`, 'REFUND_SETTLED', refundSettle(depMinor), { bookingId: id, paymentId: pid, clinicId: clinic }, terminalAt ?? now); ledger += 2;
      }
    }
    // Kiorly patient link for the clinic this booking is with (national-id-free, phone match)
    await many('kiorlyPatientLink', [{ id: `demo_kl_hv_${b.phone.slice(-4)}_${p.clinicId.slice(-8)}`, sub: subOf(b.phone), clinicId: p.clinicId, kiorlyPatientId: kiorlyPatient(b.provider, b.phone), evidence: 'PHONE', status: 'LINKED' }]);
  }

  // ── safety console feed (KXMOP12): mirrors the Kiorly alerts of Kiorex bookings; one SLO breach, every status ──
  const sa: any[] = []; const saActions: any[] = []; let alertN = 0;
  for (const b of list) for (const al of b.alerts ?? []) {
    alertN++; const sid = `kx_sa_demo_${alertN}`; const raisedAt = new Date(now.getTime() + al.raisedRel * MIN); const st = al.kiorexStatus;
    const slow = al.id === 'demo_hsa_agy_abort_old'; const deliveredAt = new Date(raisedAt.getTime() + (slow ? 95_000 : 12_000));
    const kind = al.kind === 'TIMER_EXPIRED' ? 'TIMER_EXPIRED' : al.kind;
    sa.push({ id: sid, alertId: al.id, eventId: `demo_ev_${al.id}`, bookingId: `demo_bk_${b.key}`, clinicId: prov[b.provider].clinicId, appointmentId: `demo_mk_${b.key}`, kind, district: (spec.addresses[b.phone]?.find((a) => a.key === b.addr) ?? spec.addresses[b.phone]?.[0])?.district ?? null, deliverTo: ['safety_contact', 'ops_on_call'], raisedAt, receivedAt: new Date(raisedAt.getTime() + 3_000), deliverWithinSeconds: 60, deliveredAt, deliveryMode: 'mock', deliveryRef: `mock_sms_${sid}`,
      status: st, acknowledgedAt: ['ACKNOWLEDGED', 'ESCALATED', 'RESOLVED'].includes(st) ? new Date(raisedAt.getTime() + 4 * MIN) : null, acknowledgedBy: ['ACKNOWLEDGED', 'ESCALATED', 'RESOLVED'].includes(st) ? 'demo.ops.admin' : null, escalatedAt: st === 'ESCALATED' ? new Date(raisedAt.getTime() + 15 * MIN) : null, escalatedBy: st === 'ESCALATED' ? 'system' : null, escalationLevel: st === 'ESCALATED' ? 1 : 0,
      resolvedAt: st === 'RESOLVED' ? new Date(raisedAt.getTime() + 30 * MIN) : null, resolvedBy: st === 'RESOLVED' ? 'demo.ops.admin' : null, createdAt: raisedAt });
    const acts: [string, string, string | null, number][] = [['RECEIVED', 'system', null, 3]];
    if (slow) acts.push(['DELIVERY_FAILED', 'system', 'mock: first attempt timed out', 20], ['DELIVERED', 'system', null, 95]); else acts.push(['DELIVERED', 'system', null, 12]);
    if (['ACKNOWLEDGED', 'ESCALATED', 'RESOLVED'].includes(st)) acts.push(['ACKNOWLEDGE', 'demo.ops.admin', 'Called the nurse, safe (demo)', 240]);
    if (st === 'ESCALATED') acts.push(['AUTO_ESCALATE', 'system', 'no resolution within the escalation window', 900]);
    if (st === 'RESOLVED') acts.push(['RESOLVE', 'demo.ops.admin', 'Visit closed, patient contacted (demo)', 1800]);
    acts.forEach(([action, actor, note, secs], i) => saActions.push({ id: `${sid}_a${i}`, alertId: sid, action, actor, note, createdAt: new Date(raisedAt.getTime() + secs * 1000) }));
  }
  await many('safetyAlert', sa); await many('safetyAlertAction', saActions);

  // ── family status shares (BR59): ACTIVE x2 and one STOPPED ──
  const fam: [string, string, string, string][] = [['hv_mona_enroute', 'Aisha Nassar', '+201000009501', 'ACTIVE'], ['hv_agy_arrived', 'Dalia El-Sayed', '+201000009502', 'ACTIVE'], ['hv_mona_done1', 'Samir Ali Nassar', '+201000001002', 'STOPPED']];
  await many('familyShare', fam.filter(([k]) => list.some((b) => b.key === k)).map(([k, name, phone, status], i) => ({ id: `kx_fs_demo_${i + 1}`, bookingId: `demo_bk_${k}`, sub: subOf(list.find((b) => b.key === k)!.phone), contactName: name, phoneEnc: encryptField(phone), phoneMasked: maskPhone(phone), phoneHash: blindIndex(phone), tokenHash: sha(`demo-family-share-${i + 1}`), consentAttestedAt: new Date(now.getTime() - 3_600_000), status, stoppedAt: status === 'STOPPED' ? new Date(now.getTime() - 86_400_000) : null, locale: 'ar', lastNotifiedState: status === 'ACTIVE' ? 'ON_THE_WAY' : 'FINISHED' })));

  // ── care plan bookings (P3, behind nurse.care_plans / GKN1; gate is DEV-ONLY here) ──
  const cps: any[] = [];
  for (const c of spec.carePlans) if (prov[c.provider]) cps.push({ id: c.requestRef, sub: subOf(c.phone), providerId: prov[c.provider].id, clinicId: prov[c.provider].clinicId, typeId: typeIdOf(c.provider, c.svc), status: c.kiorexStatus, visitDistrict: spec.addresses[c.phone][0].district, visitAddressId: addrId(c.phone, c.addr), preferredStartDate: at(c.startOff), kiorlyCarePlanId: `demo_cp_${c.key}`, confirmedAt: at(c.startOff - 1), createdAt: at(c.startOff - 2) });
  for (const c of spec.carePlanRequests) if (prov[c.provider]) cps.push({ id: c.id, sub: subOf(c.phone), providerId: prov[c.provider].id, clinicId: prov[c.provider].clinicId, typeId: typeIdOf(c.provider, c.svc), status: c.status, visitDistrict: spec.addresses[c.phone][0].district, visitAddressId: addrId(c.phone, c.addr), preferredStartDate: at(c.startOff), createdAt: new Date(now.getTime() - 3_600_000) });
  await many('carePlanBooking', cps);

  return `${list.length} home bookings (${Object.entries(counts).map(([k, v]) => `${k}:${v}`).join(' ')}), ${pays} deposits, ${ledger} ledger txs, ${addrRows.length} addresses, ${sa.length} safety alerts, ${cps.length} care-plan bookings`;
}
