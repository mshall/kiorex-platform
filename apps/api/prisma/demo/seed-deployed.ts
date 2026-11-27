/**
 * Kiorex platform TRIMMED demo seed for DEPLOYED non-production environments (kx-test and similar). Synthetic data only, every row registered in "DemoMarker".
 *
 *   DEMO_SEED_ALLOWED=true KIOREX_ENV=test npm run db:seed:demo:deployed -w apps/api          (ts-node; or `npm run db:seed:demo:deployed:dist` from the compiled seed image)
 *
 * What it creates (see src/common/demo-deployed-dataset.ts): 4 demo clinic organisations with 8 providers (written directly, through the same `mapProviderDto` the Clinic
 * sync uses, so the rows have the sync's shape), 12 demo patients (the Passport demo personas), 15 bookings with deposits, payments, ledger postings and payouts, reviews,
 * 12 commission claims applied through the REAL claim service (ONLINE, CASH and CASH_TRANSFER with BANK_TRANSFER / INSTAPAY / CARD_TERMINAL; PENDING, CONFIRMED, DISPUTED,
 * REVERSED, WAIVED), two collection runs, and pharmacy orders / lab bookings against the real partner catalogues when the partners answer.
 *
 * What it deliberately does NOT do: no flag gate evidence (DEV-ONLY-NOT-A-REAL-GATE), no dev product keys, no dev partner registrations, no secrets, no localhost URLs, no provider sync
 * from a Clinic. It refuses to run unless the environment is declared and is a deployed non-production one (test, staging, qa, demo, sandbox, preview), never in production.
 * Idempotent: ids are deterministic and every write is an upsert / skip-duplicates / skip-if-exists. Removal later: `npm run demo-data:remove -- --dry-run` then `--confirm`.
 */
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../src/app.module';
import { PrismaService } from '../../src/prisma/prisma.service';
import { CommissionClaimsService } from '../../src/commissions/commission-claims.service';
import { PharmacyClient } from '../../src/pharmacy/pharmacy.client';
import { LabClient } from '../../src/lab/lab.client';
import { mapProviderDto } from '../../src/catalog/provider-mapper';
import { markDemoRows } from '../../src/common/demo-data';
import { assertDemoSeedAllowed } from '../../src/common/demo-seed-guard';
import { capture, pspFee, refundRequest, refundSettle, release, payout, type Posting } from '../../src/pay/ledger';
import {
  BOOKINGS, CLAIMS, IDS, PATIENTS, PROVIDERS, RUNS, checkDeployedSeedAllowed, chargeId, claimEventData, claimEvents, clinicId, clinicianId, patientPhone,
  patientSub, providerDtos, providerId, tenantId, typeId,
} from '../../src/common/demo-deployed-dataset';

const DAY = 86_400_000;
const today0 = (() => { const d = new Date(); d.setUTCHours(0, 0, 0, 0); return d; })();
const at = (off: number, hour = 9, min = 0) => new Date(today0.getTime() + off * DAY + hour * 3_600_000 + min * 60_000);

export interface SeedDeps {
  claims: { applyEvent(type: string, data: Record<string, any>, ctx: { tenantId?: string; occurredAt?: string }): Promise<string> };
  /** Optional partner clients; when absent or unreachable the pharmacy / lab part is skipped with a note. */
  pharmacy?: { pharmacies(): Promise<{ items: any[] }>; catalogue(q: { pharmacyId?: string }): Promise<{ items: any[] }> };
  lab?: { tests(q: { labId?: string }): Promise<{ items: any[] }> };
  log?: (m: string) => void;
}

/** Writes the whole dataset. `prisma` is the platform PrismaService/PrismaClient. Returns counts per kind. */
export async function seedDeployed(prisma: any, deps: SeedDeps): Promise<Record<string, number | string>> {
  const log = deps.log ?? ((m: string) => console.log(m));
  const out: Record<string, number | string> = {};
  const many = async (model: string, rows: any[]) => { if (rows.length) await prisma[model].createMany({ data: rows, skipDuplicates: true }); };

  // ── patients (the Passport demo personas) with their consents ──
  for (const p of PATIENTS) {
    const s = patientSub(p.n);
    await prisma.patientProfile.upsert({
      where: { sub: s }, update: {},
      create: { sub: s, phone: patientPhone(p.n), nameEn: p.en, nameAr: p.ar, gender: p.g, dateOfBirth: new Date(p.dob), preferredLocale: p.loc, market: 'EG', email: `patient${p.n}@demo.kiorex.test` },
    });
    await many('consentRecord', [
      { id: `demo_cr_dx_${p.n}_1`, sub: s, purpose: 'MARKETPLACE', granted: true, version: 'v1', source: 'WEB' },
      { id: `demo_cr_dx_${p.n}_2`, sub: s, purpose: 'REMINDERS', granted: p.n % 5 !== 0, version: 'v1', source: 'WEB' },
    ]);
  }
  out.patients = PATIENTS.length;

  // ── providers: exactly what the Clinic sync writes (mapProviderDto), LIVE ──
  const updatedAt = at(-20).toISOString();
  for (const dto of providerDtos(updatedAt)) {
    const row = mapProviderDto(dto); const { id, raw, ...rest } = row;
    const existing = await prisma.provider.findUnique({ where: { id }, select: { id: true } });
    if (existing) continue; // keep ratings and anything an operator changed
    await prisma.provider.create({ data: { id, raw, ...rest } as any });
  }
  out.providers = PROVIDERS.length;

  // ── bookings, deposits, ledger, payouts ──
  const fee = (n: number) => PROVIDERS.find((p) => p.n === n)!.feeMajor * 100;
  const dep = (n: number) => (PROVIDERS.find((p) => p.n === n)!.depositMajor ?? 0) * 100;
  const post = async (key: string, kind: string, postings: Posting[], extra: { bookingId?: string; paymentId?: string; clinicId?: string }) => {
    if (await prisma.ledgerTx.findUnique({ where: { idempotencyKey: `${IDS.ledgerKey}${key}` } })) return 0;
    await prisma.ledgerTx.create({ data: { idempotencyKey: `${IDS.ledgerKey}${key}`, kind, ...extra, createdAt: at(0), entries: { create: postings.map((p) => ({ account: p.account, debitMinor: p.debit, creditMinor: p.credit })) } } as any });
    return 1;
  };
  const released = new Map<string, number>();
  let ledgerTx = 0;
  for (const b of BOOKINGS) {
    const prov = PROVIDERS.find((p) => p.n === b.provider)!; const org = prov.org; const cid = clinicId(org);
    const id = `${IDS.booking}${b.key}`; const startsAt = at(b.dayOffset, b.hourUtc);
    const depMinor = b.deposit === 'NONE' ? 0 : dep(b.provider);
    const createdAt = new Date(Math.min(startsAt.getTime(), Date.now()) - 5 * DAY);
    await prisma.bookingIntent.upsert({
      where: { id }, update: {},
      create: {
        id, sub: patientSub(b.patient), providerId: providerId(b.provider), clinicId: cid, clinicianId: clinicianId(b.provider), tenantId: tenantId(org), typeId: typeId(b.provider),
        startsAt, endsAt: new Date(startsAt.getTime() + 30 * 60_000), status: b.status, channel: 'MARKETPLACE', kiorlyAppointmentId: `demo_mk_dx${b.key}`, kiorlyPatientId: `demo_p_dx_${b.patient - 1000}`,
        currency: 'EGP', feeMinor: fee(b.provider), depositStatus: b.deposit, depositAmountMinor: depMinor, depositRefundable: b.deposit === 'REFUNDED', holdExternalRef: `${id}:hold`,
        cancelledBy: b.status === 'CANCELLED' ? (Number(b.key) % 2 ? 'PATIENT' : 'CLINIC') : null, cancellationReason: b.status === 'CANCELLED' ? 'Demo cancellation' : null,
        patientSnapshot: { forDependant: false, demo: true } as any, createdAt, terminalAt: ['COMPLETED', 'NO_SHOW', 'CANCELLED'].includes(b.status) ? startsAt : null, version: 1,
      } as any,
    });
    const evs = [['INTENT', null, 'INTENT'], ['HOLD', 'INTENT', 'HELD'], ['KIORLY_CALL', 'HELD', 'CONFIRMED'], ['WEBHOOK', 'CONFIRMED', b.status]].slice(0, b.status === 'PENDING_CLINIC' ? 3 : 4);
    await many('bookingEvent', evs.map(([kind, from, to], i) => ({ id: `${id}_ev${i}`, bookingId: id, kind, fromStatus: from, toStatus: to, detail: { demo: true } as any, createdAt: new Date(createdAt.getTime() + i * 60_000) })));
    if (depMinor > 0) {
      const pid = `${IDS.payment}${b.key}`; const psp = Math.round(depMinor * 0.02);
      await prisma.paymentIntent.upsert({
        where: { id: pid }, update: {},
        create: {
          id: pid, bookingId: id, sub: patientSub(b.patient), clinicId: cid, amountMinor: depMinor, currency: 'EGP', psp: 'sandbox-fake', pspRef: `fake_dx_${b.key}`, status: b.deposit === 'REFUNDED' ? 'REFUNDED' : 'CAPTURED',
          refundedMinor: b.deposit === 'REFUNDED' ? depMinor : 0, feeMinor: psp, purpose: 'DEPOSIT', capturedAt: createdAt, releasedAt: ['RELEASED', 'FORFEITED'].includes(b.deposit) ? startsAt : null,
          releaseKind: b.deposit === 'RELEASED' ? 'COMPLETED' : b.deposit === 'FORFEITED' ? 'FORFEITED' : null,
        } as any,
      });
      ledgerTx += await post(`cap:${pid}`, 'CAPTURE', capture(cid, depMinor), { bookingId: id, paymentId: pid, clinicId: cid });
      ledgerTx += await post(`fee:${pid}`, 'PSP_FEE', pspFee(psp), { paymentId: pid, clinicId: cid });
      if (b.deposit === 'RELEASED' || b.deposit === 'FORFEITED') {
        ledgerTx += await post(`rel:${pid}`, `RELEASE_${b.deposit === 'RELEASED' ? 'COMPLETED' : 'FORFEITED'}`, release(cid, depMinor), { bookingId: id, paymentId: pid, clinicId: cid });
        released.set(cid, (released.get(cid) ?? 0) + depMinor);
      }
      if (b.deposit === 'REFUNDED') {
        const rid = `${IDS.refund}${b.key}`;
        await prisma.refund.upsert({ where: { id: rid }, update: {}, create: { id: rid, paymentId: pid, amountMinor: depMinor, reason: 'CLINIC_CANCELLED', idempotencyKey: `demo:dx:${rid}`, status: 'SETTLED', pspRefundRef: `fake_dx_rf_${b.key}`, settledAt: startsAt } as any });
        ledgerTx += await post(`rfr:${rid}`, 'REFUND_REQUEST', refundRequest(cid, depMinor), { bookingId: id, paymentId: pid, clinicId: cid });
        ledgerTx += await post(`rfs:${rid}`, 'REFUND_SETTLED', refundSettle(depMinor), { bookingId: id, paymentId: pid, clinicId: cid });
      }
    }
  }
  const periodKey = `${new Date().getUTCFullYear()}-W${String(Math.ceil((Date.now() - Date.UTC(new Date().getUTCFullYear(), 0, 1)) / (7 * DAY))).padStart(2, '0')}`;
  let po = 0;
  for (const [cid, amt] of released) {
    const id = `${IDS.payout}${++po}`;
    if (await prisma.payout.findUnique({ where: { id } })) continue;
    await prisma.payout.create({ data: { id, payoutRef: `demo-dx-payout-${po}`, clinicId: cid, amountMinor: amt, periodKey, paymentRefs: [] as any, status: po % 2 ? 'KIORLY_RECORDED' : 'SENT', paidAt: at(-2) } as any });
    ledgerTx += await post(`po:${id}`, 'PAYOUT', payout(cid, amt), { clinicId: cid });
  }
  out.bookings = BOOKINGS.length; out.ledgerTx = ledgerTx;

  // ── reviews on completed visits, then the provider rating aggregates ──
  const rated = new Map<number, number[]>();
  for (const b of BOOKINGS.filter((x) => x.review && x.status === 'COMPLETED')) {
    const id = `${IDS.booking}${b.key}`;
    await many('review', [{
      id: `${IDS.review}${b.key}`, bookingId: id, sub: patientSub(b.patient), providerId: providerId(b.provider), clinicId: clinicId(PROVIDERS.find((p) => p.n === b.provider)!.org), clinicianId: clinicianId(b.provider),
      kiorlyAppointmentId: `demo_mk_dx${b.key}`, rating: b.review!.rating, text: b.review!.text, status: 'VISIBLE', editableUntil: at(b.dayOffset + 3), syncStatus: 'SYNCED', createdAt: at(b.dayOffset + 1),
    }]);
    rated.set(b.provider, [...(rated.get(b.provider) ?? []), b.review!.rating]);
  }
  for (const [n, rs] of rated) await prisma.provider.update({ where: { id: providerId(n) }, data: { ratingAvg: Math.round((rs.reduce((a, c) => a + c, 0) / rs.length) * 10) / 10, ratingCount: rs.length } as any });
  out.reviews = [...rated.values()].reduce((a, r) => a + r.length, 0);

  // ── commission claims through the real claim service (rate snapshot, org link and timeline come from it) ──
  let claimsNew = 0;
  for (const c of CLAIMS) {
    if (await prisma.commissionClaim.findUnique({ where: { chargeId: chargeId(c.key) } })) continue; // never replay: a re-sent CREATED would re-activate a reversed claim
    const base = Date.now() - c.attendedDaysAgo * DAY;
    let i = 0;
    for (const ev of claimEvents(c)) {
      await deps.claims.applyEvent(ev.type, claimEventData(c, ev.status), { tenantId: tenantId(c.org), occurredAt: new Date(base + (i++) * 3_600_000).toISOString() });
    }
    claimsNew++;
  }
  out.claimsNew = claimsNew; out.claims = CLAIMS.length;

  // ── two collection runs: an open invoice (organisation 1, cash-type claims) and a settled run netted from payouts (organisation 2, online claims) ──
  const cutoff = new Date(Date.UTC(today0.getUTCFullYear(), today0.getUTCMonth(), 1) - DAY); const periodDay = cutoff.toISOString().slice(0, 10);
  let runsNew = 0;
  for (const r of RUNS) {
    if (await prisma.commissionRun.findUnique({ where: { id: r.id } })) continue;
    const specs = CLAIMS.filter((c) => c.run === r.claimSet && c.org === r.org);
    const rows = await prisma.commissionClaim.findMany({ where: { chargeId: { in: specs.map((c) => chargeId(c.key)) } } });
    if (!rows.length) continue;
    const sum = rows.reduce((a: number, x: any) => a + x.amountMinor, 0); const invoice = r.claimSet === 'INVOICE';
    await prisma.commissionRun.create({
      data: {
        id: r.id, orgRef: tenantId(r.org), market: 'EG', periodKey: periodDay, cutoffAt: cutoff, collectAt: new Date(cutoff.getTime() + DAY), modeRequested: r.mode, mode: r.mode, provider: null, status: r.status, currency: 'EGP',
        claimsCount: rows.length, claimsMinor: sum, collectedMinor: 0, deductedMinor: invoice ? 0 : sum, invoicedMinor: invoice ? sum : 0, paidMinor: 0, settingsJson: { demo: true, note: 'Demo run: figures are synthetic' },
        invoiceNo: r.invoiceNo, invoiceDueAt: invoice ? at(14) : null, idempotencyKey: `demo:dx:run:${r.id}`,
      } as any,
    });
    await prisma.commissionClaim.updateMany({ where: { id: { in: rows.map((x: any) => x.id) } }, data: { runId: r.id, collectionStatus: invoice ? 'INVOICED' : 'COLLECTED', collectedMinor: invoice ? 0 : undefined } as any });
    if (!invoice) for (const x of rows) await prisma.commissionClaim.update({ where: { id: x.id }, data: { collectedMinor: x.amountMinor } });
    await prisma.commissionAttempt.create({
      data: { id: `${IDS.attempt}${r.id}`, runId: r.id, orgRef: tenantId(r.org), attemptNo: 1, kind: invoice ? 'INVOICE' : 'DEDUCT', amountMinor: sum, status: 'SUCCEEDED', retryable: false, executedAt: cutoff, idempotencyKey: `demo:dx:attempt:${r.id}` } as any,
    });
    runsNew++;
  }
  out.runsNew = runsNew;

  // ── pharmacy orders and lab bookings against the REAL partner catalogues (signed requests through the platform's own clients) ──
  let ph = 0, lb = 0;
  try {
    const pharmacies = await deps.pharmacy?.pharmacies();
    const first = pharmacies?.items?.[0];
    const cat = first ? await deps.pharmacy!.catalogue({ pharmacyId: first.id }) : null;
    const items: any[] = (cat?.items ?? []).filter((i: any) => !String(i.name ?? '').startsWith('E2E') && !i.rxRequired && !i.controlled && i.available !== false).slice(0, 12);
    const reg = await prisma.partnerRegistration.findFirst({ where: { kind: 'PHARMACY', active: true }, select: { id: true } });
    if (first && items.length >= 4) {
      const ST = ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'READY', 'DISPENSED', 'DISPENSED', 'REJECTED', 'CANCELLED'];
      for (const [i, st] of ST.entries()) {
        const lines = [items[i % items.length], items[(i + 3) % items.length]].map((x) => ({ sku: x.sku, name: x.name, qty: 1 + (i % 2), unitMinor: x.priceMinor }));
        const subtotal = lines.reduce((a, l) => a + l.qty * l.unitMinor, 0);
        await prisma.pharmacyOrder.upsert({
          where: { id: `${IDS.pharmacyOrder}${i + 1}` }, update: {},
          create: {
            id: `${IDS.pharmacyOrder}${i + 1}`, sub: patientSub(1001 + (i % 8)), pharmacyId: first.id, registrationId: reg?.id, status: st, items: lines as any, subtotalMinor: subtotal, totalMinor: subtotal, deliveryMethod: i % 2 ? 'DELIVERY' : 'PICKUP',
            deliveryFeeMinor: 0, currency: 'EGP', deliveryAddress: i % 2 ? ({ line1: '12 Demo Street', city: 'Cairo' } as any) : undefined, rxStatus: 'NOT_REQUIRED',
            partnerOrderId: ['SUBMITTED', 'READY', 'DISPENSED', 'REJECTED'].includes(st) ? `ph_ord_demo_dx${i + 1}` : undefined, takeRateBps: 200, platformFeeMinor: Math.round(subtotal * 0.02),
            rejectionReason: st === 'REJECTED' ? 'Out of stock (demo)' : undefined, readyAt: ['READY', 'DISPENSED'].includes(st) ? at(-i) : undefined, dispensedAt: st === 'DISPENSED' ? at(-i, 12) : undefined, createdAt: at(-i - 1),
          } as any,
        });
        ph++;
      }
    } else log('demo-deployed: pharmacy partner empty or unreachable, pharmacy orders skipped');
  } catch (e) { log(`demo-deployed: pharmacy part skipped (${String((e as Error).message).slice(0, 120)})`); }
  try {
    const t = await deps.lab?.tests({});
    const tests: any[] = (t?.items ?? []).filter((x: any) => !String(x.name ?? '').startsWith('E2E')).slice(0, 10);
    const reg = await prisma.partnerRegistration.findFirst({ where: { kind: 'LAB', active: true }, select: { id: true } });
    if (tests.length >= 3) {
      const labId = tests[0].labId;
      const ST = ['PENDING_PAYMENT', 'PAID', 'SUBMITTED', 'COLLECTED', 'RESULT_RELEASED', 'RESULT_RELEASED', 'REJECTED', 'CANCELLED'];
      for (const [i, st] of ST.entries()) {
        const ts = [tests[i % tests.length], tests[(i + 2) % tests.length]].map((x) => ({ code: x.code, name: x.name, priceMinor: x.priceMinor })); const subtotal = ts.reduce((a, x) => a + x.priceMinor, 0);
        await prisma.labBooking.upsert({
          where: { id: `${IDS.labBooking}${i + 1}` }, update: {},
          create: {
            id: `${IDS.labBooking}${i + 1}`, sub: patientSub(1004 + (i % 8)), labId, registrationId: reg?.id, tests: ts as any, collectionType: i % 2 ? 'HOME' : 'WALK_IN', slotStartsAt: at(i - 3, 8), slotEndsAt: at(i - 3, 9), status: st,
            subtotalMinor: subtotal, totalMinor: subtotal, collectionFeeMinor: 0, currency: 'EGP', partnerOrderId: ['SUBMITTED', 'COLLECTED', 'RESULT_RELEASED'].includes(st) ? `lab_ord_demo_dx${i + 1}` : undefined,
            takeRateBps: 300, platformFeeMinor: Math.round(subtotal * 0.03), rejectionReason: st === 'REJECTED' ? 'Slot unavailable (demo)' : undefined, createdAt: at(i - 5),
          } as any,
        });
        lb++;
      }
    } else log('demo-deployed: lab partner empty or unreachable, lab bookings skipped');
  } catch (e) { log(`demo-deployed: lab part skipped (${String((e as Error).message).slice(0, 120)})`); }
  out.pharmacyOrders = ph; out.labBookings = lb;

  // ── the durable marker: removal later selects ONLY these rows ──
  out.markers = JSON.stringify(await markDemoRows(prisma as never, { batch: 'seed-deployed' }));
  log(`demo-deployed: ${JSON.stringify(out)}`);
  return out;
}

async function main() {
  const environment = checkDeployedSeedAllowed();
  assertDemoSeedAllowed(`Kiorex platform trimmed demo seed for a deployed environment (${environment})`);
  process.env.JOBS_ENABLED = 'false';
  const app = await NestFactory.createApplicationContext(AppModule, { logger: ['error'] });
  try {
    const prisma = app.get(PrismaService);
    const pharmacyClient = app.get(PharmacyClient, { strict: false }); const labClient = app.get(LabClient, { strict: false });
    await seedDeployed(prisma, {
      claims: app.get(CommissionClaimsService, { strict: false }),
      // the partner clients answer { status, data }: hand the seed the bodies only
      pharmacy: { pharmacies: async () => (await pharmacyClient.pharmacies()).data, catalogue: async (q) => (await pharmacyClient.catalogue(q)).data },
      lab: { tests: async (q) => (await labClient.tests(q)).data },
    });
  } finally { await app.close(); }
}
if (typeof require !== 'undefined' && typeof module !== 'undefined' && require.main === module) main().then(() => process.exit(0)).catch((e) => { console.error(e instanceof Error ? e.message : e); process.exit(1); });
