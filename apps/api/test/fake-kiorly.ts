import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { verifyKiorlyRequest } from '@kiorex/contracts';

type Mode = undefined | '409-identity' | '409' | 'timeout' | 'timeout-created' | '5xx' | '422-window' | '422-coverage';

/** In-process fake Kiorly marketplace API. Verifies the HMAC on every request (so client signing is under test). */
export class FakeKiorly {
  server!: Server;
  port = 0;
  providers: any[] = [];
  slots: { startsAt: string; endsAt: string }[] = [];
  /** clinicianId -> slots (overrides `slots` for in-clinic queries): lets a test give each provider a different earliest slot. */
  slotsByClinician = new Map<string, { startsAt: string; endsAt: string }[]>();
  bookings = new Map<string, any>();
  holds = new Map<string, any>();
  calls: { method: string; path: string; body: any; headers: Record<string, any> }[] = [];
  deposits = new Map<string, any>();
  payouts = new Map<string, any>();
  reviewPushes: any[] = [];
  profileViews: any[] = [];
  consentPushes: { patientId: string; consents: any[] }[] = [];
  /** patient ids the clinic does not know: POST /patients/:id/consents answers 404 for them (stale KiorlyPatientLink). */
  unknownPatients = new Set<string>();
  bookingMode: Mode;
  holdMode: Mode;
  /** GRW-P1-G: a hold on a slot (clinician + start) that is already held answers 409 SLOT_TAKEN with alternatives, like the Clinic's transactional hold. */
  exclusiveHolds = false;
  /** Rev 2.3 (contracts 1.5.0): '422-coverage' answers every HOME slot query with 422 OUT_OF_COVERAGE regardless of the provider's coverage list. */
  slotsMode: Mode;
  carePlanMode: undefined | '422-not-offered';
  carePlanRequests = new Map<string, any>();
  /** KNLAB01 (contracts 1.6.0): lab status pushes received at POST /lab-orders/:orderId/status, in order. `labStatusMode` makes the clinic answer 5xx (retry) or 404 (permanent). */
  labStatusPushes: { orderId: string; body: any }[] = [];
  labStatusMode: undefined | '5xx' | '404';
  /** appointmentId -> visitAddress carried from the hold (Kiorly stores it encrypted; the fake keeps it so tests can assert what was sent). */
  addresses = new Map<string, any>();
  getBookingMode: Mode;
  cancelMode: Mode;
  autoConfirm = true;
  rejectReviews: string[] = [];
  depositRefundable: boolean | undefined = true;
  bad = 0;

  async start() {
    this.server = createServer((req, res) => void this.handle(req, res));
    await new Promise<void>((r) => this.server.listen(0, '127.0.0.1', r));
    this.port = (this.server.address() as any).port;
    process.env.KIORLY_BASE_URL = `http://127.0.0.1:${this.port}/marketplace/v1`;
    return this;
  }
  async stop() { await new Promise((r) => this.server.close(r)); }
  reset() {
    this.providers = []; this.slots = []; this.slotsByClinician.clear(); this.bookings.clear(); this.holds.clear(); this.calls = []; this.deposits.clear(); this.payouts.clear(); this.reviewPushes = []; this.profileViews = []; this.consentPushes = []; this.unknownPatients.clear();
    this.slotsMode = undefined; this.carePlanMode = undefined; this.carePlanRequests.clear(); this.addresses.clear(); this.labStatusPushes = []; this.labStatusMode = undefined;
    this.bookingMode = this.holdMode = this.getBookingMode = this.cancelMode = undefined; this.autoConfirm = true; this.exclusiveHolds = false; this.rejectReviews = []; this.depositRefundable = true; this.bad = 0;
  }
  callsTo(method: string, pathPart: string) { return this.calls.filter((c) => c.method === method && c.path.includes(pathPart)); }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const v = verifyKiorlyRequest({ headers: req.headers as any, method: req.method!, path: url.pathname, body: raw, secret: 'kx_dev_secret_change_me' });
    if (!v.ok || req.headers['x-kiorly-client-key'] !== 'kx_dev_client') { this.bad++; return this.send(res, 401, { code: 'BAD_HMAC', reason: (v as any).reason }); }
    const path = url.pathname.replace('/marketplace/v1', '');
    const body = raw.length ? JSON.parse(raw.toString()) : undefined;
    this.calls.push({ method: req.method!, path, body, headers: req.headers });
    const m = req.method!;
    const send = (s: number, b: any) => this.send(res, s, b);
    const hang = () => new Promise<void>(() => undefined);

    if (m === 'GET' && path === '/providers') {
      const since = url.searchParams.get('updatedSince');
      const items = this.providers.filter((p) => !since || p.updatedAt >= since);
      return send(200, { items, page: 1, pageSize: 100, total: items.length });
    }
    if (m === 'GET' && /^\/clinics\/[^/]+\/slots$/.test(path)) {
      const loc = url.searchParams.get('serviceLocation') ?? 'IN_CLINIC';
      const district = url.searchParams.get('district');
      if (loc === 'HOME') {
        if (!district) return send(400, { code: 'DISTRICT_REQUIRED', message: 'district required for HOME' });
        const prov = this.providers.find((p) => p.clinicianId === url.searchParams.get('clinicianId'));
        const covered: string[] = prov?.coverageDistricts ?? [];
        if (this.slotsMode === '422-coverage' || (covered.length && !covered.includes(district))) return send(422, { statusCode: 422, code: 'OUT_OF_COVERAGE', message: 'District is not covered', district, alternatives: [] });
        return send(200, { slots: this.slots.map((s) => ({ ...s, serviceLocation: 'HOME', district })) });
      }
      const own = this.slotsByClinician.get(url.searchParams.get('clinicianId') ?? '');
      return send(200, { slots: (own ?? this.slots).map((s) => ({ ...s, serviceLocation: 'IN_CLINIC', district: null })) });
    }
    if (m === 'POST' && path === '/holds') {
      if (this.holdMode === '409') return send(409, { code: 'SLOT_TAKEN', message: 'Slot not available', alternatives: this.slots.slice(1, 4) });
      if (this.holdMode === '5xx') return send(503, { message: 'down' });
      if (this.exclusiveHolds && [...this.holds.values()].some((h) => h.clinicianId === body.clinicianId && h.startsAt === body.startsAt)) return send(409, { code: 'SLOT_TAKEN', message: 'Slot not available', alternatives: this.slots.filter((x) => x.startsAt !== body.startsAt).slice(0, 3) });
      const prov = this.providers.find((p) => p.clinicianId === body.clinicianId);
      const fee = prov?.provider?.fees?.find((f: any) => f.appointmentTypeId === body.typeId);
      const homeType = (fee?.serviceLocation ?? (prov?.serviceLocations?.length === 1 ? prov.serviceLocations[0] : 'IN_CLINIC')) === 'HOME';
      if (homeType) {
        if (!body.visitAddress?.district) return send(422, { code: 'VISIT_ADDRESS_REQUIRED', message: 'visitAddress required for HOME visit types' });
        const covered: string[] = prov?.coverageDistricts ?? [];
        if (this.holdMode === '422-coverage' || (covered.length && !covered.includes(body.visitAddress.district))) return send(422, { statusCode: 422, code: 'OUT_OF_COVERAGE', message: 'District is not covered', district: body.visitAddress.district });
      }
      const id = `hold_${this.holds.size + 1}`;
      const h = { id, ...body, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
      this.holds.set(body.externalRef, h);
      return send(201, h);
    }
    if (m === 'DELETE' && path.startsWith('/holds/')) return send(200, { ok: true });
    if (m === 'POST' && path === '/bookings') {
      const key = req.headers['idempotency-key'] as string;
      if (this.bookings.has(key)) return send(200, this.bookings.get(key));
      if (this.bookingMode === '422-coverage') return send(422, { statusCode: 422, code: 'OUT_OF_COVERAGE', message: 'District is not covered anymore' });
      if (this.bookingMode === '409-identity') return send(409, { code: 'PATIENT_IDENTITY_CONFLICT', message: 'phone and national id match different patients' });
      if (this.bookingMode === '409') return send(409, { code: 'SLOT_TAKEN', message: 'taken', alternatives: this.slots.slice(1, 4) });
      if (this.bookingMode === '5xx') return send(502, { message: 'bad gateway' });
      if (this.bookingMode === 'timeout') return hang();
      const b = this.makeBooking(key, body);
      this.bookings.set(key, b);
      if (this.bookingMode === 'timeout-created') return hang();
      return send(201, b);
    }
    const bm = path.match(/^\/bookings\/([^/]+)(?:\/(cancel|reschedule|deposit-paid))?$/);
    if (bm) {
      const [, ref, action] = bm;
      if (m === 'GET' && !action) {
        if (this.getBookingMode === '5xx') return send(503, {});
        if (this.getBookingMode === 'timeout') return hang();
        const b = this.bookings.get(ref);
        return b ? send(200, b) : send(404, { message: 'Booking not found' });
      }
      const b = this.bookings.get(ref);
      if (!b) return send(404, { message: 'Booking not found' });
      if (action === 'cancel') {
        if (this.cancelMode === '422-window') return send(422, { code: 'CANCELLATION_WINDOW_CLOSED', message: 'window closed' });
        b.status = 'CANCELLED'; b.cancelledBy = 'PATIENT'; b.depositRefundable = this.depositRefundable;
        return send(200, b);
      }
      if (action === 'reschedule') {
        if (this.cancelMode === '409') return send(409, { code: 'SLOT_TAKEN', alternatives: this.slots.slice(0, 3) });
        b.startsAt = body.startsAt; b.endsAt = body.endsAt ?? b.endsAt; b.rescheduleCount++;
        return send(200, b);
      }
      if (action === 'deposit-paid') {
        const ex = this.deposits.get(body.paymentRef);
        if (!ex) this.deposits.set(body.paymentRef, { ref, ...body });
        return send(200, this.deposits.get(body.paymentRef));
      }
    }
    if (m === 'POST' && /^\/lab-orders\/[^/]+\/status$/.test(path)) {
      if (this.labStatusMode === '5xx') return send(503, {});
      if (this.labStatusMode === '404') return send(404, { code: 'LAB_HANDOFF_NOT_FOUND' });
      this.labStatusPushes.push({ orderId: decodeURIComponent(path.split('/')[2]), body });
      return send(200, { applied: true, status: body.status });
    }
    if (m === 'POST' && path === '/care-plan-requests') {
      if (this.carePlanMode === '422-not-offered') return send(422, { code: 'CARE_PLANS_NOT_OFFERED', message: 'provider does not offer care plans' });
      const ex = this.carePlanRequests.get(body.requestRef);
      if (ex) return send(200, ex.ack);
      const ack = { requestRef: body.requestRef, status: 'RECEIVED', carePlanId: null };
      this.carePlanRequests.set(body.requestRef, { body, ack });
      return send(200, ack);
    }
    if (m === 'POST' && path === '/payouts') {
      const ex = this.payouts.get(body.payoutRef);
      if (!ex) this.payouts.set(body.payoutRef, body);
      return send(200, this.payouts.get(body.payoutRef));
    }
    if (m === 'POST' && path === '/reviews/aggregate') {
      this.reviewPushes.push(body);
      return send(200, { accepted: body.reviews.length, rejected: body.reviews.filter((r: any) => this.rejectReviews.includes(r.reviewId)).map((r: any) => ({ reviewId: r.reviewId, reason: 'NOT_A_COMPLETED_VISIT' })) });
    }
    if (m === 'POST' && path === '/analytics/profile-views') { this.profileViews.push(body); return send(200, { accepted: body.items.length, rejected: [] }); }
    const cp = path.match(/^\/patients\/([^/]+)\/consents$/);
    if (m === 'POST' && cp && this.unknownPatients.has(cp[1])) return send(404, { code: 'PATIENT_NOT_FOUND' });
    if (m === 'POST' && cp) { this.consentPushes.push({ patientId: cp[1], consents: body.consents }); return send(200, body.consents); }
    const dl = path.match(/^\/deposit-links\/([^/]+)\/paid$/);
    if (m === 'POST' && dl) { this.deposits.set(body.paymentRef, { link: dl[1], ...body }); return send(200, { ok: true }); }
    return send(404, { message: `no route ${m} ${path}` });
  }

  makeBooking(key: string, body: any) {
    const hold = [...this.holds.values()].find((h) => h.externalRef === body.holdExternalRef);
    if (body.serviceLocation === 'HOME' && hold?.visitAddress) this.addresses.set(`apt_${this.bookings.size + 1}`, hold.visitAddress);
    return {
      serviceLocation: body.serviceLocation ?? 'IN_CLINIC',
      appointmentId: `apt_${this.bookings.size + 1}`, clinicId: body.clinicId, clinicianId: body.clinicianId, patientId: `pat_${body.patient.phone}`, typeId: body.typeId, startsAt: body.startsAt, endsAt: body.endsAt,
      status: this.autoConfirm ? 'CONFIRMED' : 'SCHEDULED', externalReference: key, bookingSource: 'KIOREX_MARKETPLACE', marketplaceConfirmationDueAt: this.autoConfirm ? null : new Date(Date.now() + 3600_000).toISOString(),
      cancelledBy: null, cancellationReason: null, depositRefundable: null, rescheduleCount: 0,
    };
  }
  private send(res: ServerResponse, status: number, body: any) {
    res.writeHead(status, { 'content-type': 'application/json' });
    res.end(JSON.stringify(body));
  }

  /** A Kiorly PublishedProviderDto (shape of marketplace-provider-profile.service.ts). */
  static provider(o: { profession?: string; edition?: string; serviceLocations?: string[]; coverageDistricts?: string[]; assignsClinician?: boolean; register?: string; homeSurcharge?: number; feeServiceLocation?: string; id?: string; clinicId?: string; clinicianId?: string; status?: string; specialty?: string; nameEn?: string; nameAr?: string; area?: string; governorate?: string; fee?: number; updatedAt?: string; tenantId?: string; lat?: number; lng?: number; gender?: string; languages?: string[]; depositAmount?: number; depositRequired?: boolean; typeId?: string }) {
    const id = o.id ?? 'lst_1';
    return {
      ...(o.profession ? { profession: o.profession } : {}), ...(o.edition ? { edition: o.edition } : {}), ...(o.serviceLocations ? { serviceLocations: o.serviceLocations } : {}), ...(o.coverageDistricts ? { coverageDistricts: o.coverageDistricts } : {}),
      ...(o.assignsClinician !== undefined ? { assignsClinician: o.assignsClinician } : {}), ...(o.register ? { verification: { register: o.register } } : {}),
      listingId: id, tenantId: o.tenantId ?? 'tn_1', clinicId: o.clinicId ?? 'cl_1', clinicianId: o.clinicianId ?? 'dr_1', status: o.status ?? 'LIVE', completenessPercent: 90, updatedAt: o.updatedAt ?? new Date().toISOString(),
      provider: { displayNameEn: o.nameEn ?? 'Dr Sara Hassan', displayNameAr: o.nameAr ?? 'د. سارة حسن', specialty: o.specialty ?? 'dermatology', languages: o.languages ?? ['ar', 'en'], gender: o.gender ?? 'FEMALE', governorate: o.governorate ?? 'Cairo', area: o.area ?? 'Maadi', cancellationPolicy: { hoursBefore: 'NEEDS_HUMAN' },
        fees: [{ appointmentTypeId: o.typeId ?? 'typ_1', nameEn: 'Consultation', nameAr: 'كشف', amount: o.fee ?? 300, currency: 'EGP', ...(o.depositAmount ? { depositAmount: o.depositAmount } : {}), ...(o.depositRequired ? { depositRequired: true } : {}), ...(o.feeServiceLocation ? { serviceLocation: o.feeServiceLocation } : {}), ...(o.homeSurcharge !== undefined ? { homeSurcharge: o.homeSurcharge } : {}) }], payers: [] },
      clinic: { nameEn: 'Nile Clinic', nameAr: 'عيادة النيل', addressEn: '1 Street Maadi', addressAr: 'شارع ١ المعادي', latitude: o.lat ?? 29.96, longitude: o.lng ?? 31.25, phone: '+20221234567', logoUrl: null, clinicalSpecialty: o.specialty ?? 'dermatology', parking: true, wheelchairAccess: true, amenities: [], photos: [] },
    };
  }
}


/** Event payloads (`data`) as the kiorex-contracts 1.5.0 schemas define them; tests pass these to `ctx.webhook(type, data)`. Never any address/phone. */
export const homeEvents = {
  assigned: (o: { bookingId: string; appointmentId?: string; clinicId?: string; name?: string; badge?: string; profession?: string }) => ({
    appointmentId: o.appointmentId ?? 'apt_1', clinicId: o.clinicId ?? 'cl_1', externalReference: o.bookingId, serviceLocation: 'HOME',
    assignee: { clinicianId: 'clin_9', displayName: o.name ?? 'Nurse Mona Adel', photoUrl: 'https://cdn.kiorly.test/p/clin_9.jpg', badge: o.badge ?? 'Verified nurse', profession: o.profession ?? 'NURSE' }, assignedAt: new Date().toISOString(),
  }),
  enRoute: (o: { bookingId: string; appointmentId?: string; clinicId?: string; etaMinutes?: number }) => ({
    appointmentId: o.appointmentId ?? 'apt_1', clinicId: o.clinicId ?? 'cl_1', externalReference: o.bookingId, serviceLocation: 'HOME', enRouteAt: new Date().toISOString(), ...(o.etaMinutes !== undefined ? { etaMinutes: o.etaMinutes } : {}),
  }),
  abortedUnsafe: (o: { bookingId: string; appointmentId?: string; clinicId?: string; district?: string }) => ({
    appointmentId: o.appointmentId ?? 'apt_1', clinicId: o.clinicId ?? 'cl_1', externalReference: o.bookingId, serviceLocation: 'HOME', abortedAt: new Date().toISOString(), reasonCategory: 'UNSAFE_ENVIRONMENT', noShow: false, depositAction: 'HOLD_FOR_REVIEW', ...(o.district ? { district: o.district } : {}),
  }),
  safetyAlert: (o: { alertId?: string; bookingId?: string; appointmentId?: string; clinicId?: string; kind?: 'TIMER_EXPIRED' | 'SOS' | 'UNSAFE_ABORT'; raisedAt?: string; district?: string; deliverTo?: string[] }) => ({
    alertId: o.alertId ?? 'alert_1', clinicId: o.clinicId ?? 'cl_1', appointmentId: o.appointmentId ?? 'apt_1', ...(o.bookingId ? { externalReference: o.bookingId } : {}), kind: o.kind ?? 'SOS', raisedAt: o.raisedAt ?? new Date().toISOString(),
    deliverTo: o.deliverTo ?? ['ORG_SAFETY_CONTACT', 'KIOREX_OPS'], deliverWithinSeconds: 60, ...(o.district ? { district: o.district } : {}),
  }),
  carePlanConfirmed: (o: { carePlanId?: string; requestRef: string; clinicId?: string; visits: { appointmentId: string; startsAt: string; endsAt: string }[] }) => ({
    carePlanId: o.carePlanId ?? 'cp_1', clinicId: o.clinicId ?? 'cl_1', requestRef: o.requestRef, edition: 'NURSE', confirmedAt: new Date().toISOString(), visits: o.visits,
  }),
  carePlanEnded: (o: { carePlanId?: string; requestRef?: string; clinicId?: string; reason?: string; completed?: number; cancelledAppointmentIds?: string[] }) => ({
    carePlanId: o.carePlanId ?? 'cp_1', clinicId: o.clinicId ?? 'cl_1', requestRef: o.requestRef ?? null, endedAt: new Date().toISOString(), reason: o.reason ?? 'COMPLETED', visitsCompleted: o.completed ?? 0, cancelledAppointmentIds: o.cancelledAppointmentIds ?? [],
  }),
};
