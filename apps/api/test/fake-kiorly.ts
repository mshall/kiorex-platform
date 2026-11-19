import { createServer, IncomingMessage, Server, ServerResponse } from 'node:http';
import { verifyKiorlyRequest } from '@kiorex/contracts';

type Mode = undefined | '409-identity' | '409' | 'timeout' | 'timeout-created' | '5xx' | '422-window';

/** In-process fake Kiorly marketplace API. Verifies the HMAC on every request (so client signing is under test). */
export class FakeKiorly {
  server!: Server;
  port = 0;
  providers: any[] = [];
  slots: { startsAt: string; endsAt: string }[] = [];
  bookings = new Map<string, any>();
  holds = new Map<string, any>();
  calls: { method: string; path: string; body: any; headers: Record<string, any> }[] = [];
  deposits = new Map<string, any>();
  payouts = new Map<string, any>();
  reviewPushes: any[] = [];
  profileViews: any[] = [];
  bookingMode: Mode;
  holdMode: Mode;
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
    process.env.KIORLY_BASE_URL = `http://127.0.0.1:${this.port}/api/v1/marketplace/v1`;
    return this;
  }
  async stop() { await new Promise((r) => this.server.close(r)); }
  reset() {
    this.providers = []; this.slots = []; this.bookings.clear(); this.holds.clear(); this.calls = []; this.deposits.clear(); this.payouts.clear(); this.reviewPushes = []; this.profileViews = [];
    this.bookingMode = this.holdMode = this.getBookingMode = this.cancelMode = undefined; this.autoConfirm = true; this.rejectReviews = []; this.depositRefundable = true; this.bad = 0;
  }
  callsTo(method: string, pathPart: string) { return this.calls.filter((c) => c.method === method && c.path.includes(pathPart)); }

  private async handle(req: IncomingMessage, res: ServerResponse) {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const raw = Buffer.concat(chunks);
    const url = new URL(req.url!, 'http://x');
    const v = verifyKiorlyRequest({ headers: req.headers as any, method: req.method!, path: url.pathname, body: raw, secret: 'kx_dev_secret_change_me' });
    if (!v.ok || req.headers['x-kiorly-client-key'] !== 'kx_dev_client') { this.bad++; return this.send(res, 401, { code: 'BAD_HMAC', reason: (v as any).reason }); }
    const path = url.pathname.replace('/api/v1/marketplace/v1', '');
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
    if (m === 'GET' && /^\/clinics\/[^/]+\/slots$/.test(path)) return send(200, { slots: this.slots });
    if (m === 'POST' && path === '/holds') {
      if (this.holdMode === '409') return send(409, { code: 'SLOT_TAKEN', message: 'Slot not available', alternatives: this.slots.slice(1, 4) });
      if (this.holdMode === '5xx') return send(503, { message: 'down' });
      const id = `hold_${this.holds.size + 1}`;
      const h = { id, ...body, expiresAt: new Date(Date.now() + 5 * 60_000).toISOString() };
      this.holds.set(body.externalRef, h);
      return send(201, h);
    }
    if (m === 'DELETE' && path.startsWith('/holds/')) return send(200, { ok: true });
    if (m === 'POST' && path === '/bookings') {
      const key = req.headers['idempotency-key'] as string;
      if (this.bookings.has(key)) return send(200, this.bookings.get(key));
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
    const dl = path.match(/^\/deposit-links\/([^/]+)\/paid$/);
    if (m === 'POST' && dl) { this.deposits.set(body.paymentRef, { link: dl[1], ...body }); return send(200, { ok: true }); }
    return send(404, { message: `no route ${m} ${path}` });
  }

  makeBooking(key: string, body: any) {
    return {
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
  static provider(o: { id?: string; clinicId?: string; clinicianId?: string; status?: string; specialty?: string; nameEn?: string; nameAr?: string; area?: string; governorate?: string; fee?: number; updatedAt?: string; tenantId?: string; lat?: number; lng?: number; gender?: string; languages?: string[]; depositAmount?: number; typeId?: string }) {
    const id = o.id ?? 'lst_1';
    return {
      listingId: id, tenantId: o.tenantId ?? 'tn_1', clinicId: o.clinicId ?? 'cl_1', clinicianId: o.clinicianId ?? 'dr_1', status: o.status ?? 'LIVE', completenessPercent: 90, updatedAt: o.updatedAt ?? new Date().toISOString(),
      provider: { displayNameEn: o.nameEn ?? 'Dr Sara Hassan', displayNameAr: o.nameAr ?? 'د. سارة حسن', specialty: o.specialty ?? 'dermatology', languages: o.languages ?? ['ar', 'en'], gender: o.gender ?? 'FEMALE', governorate: o.governorate ?? 'Cairo', area: o.area ?? 'Maadi', cancellationPolicy: { hoursBefore: 'NEEDS_HUMAN' },
        fees: [{ appointmentTypeId: o.typeId ?? 'typ_1', nameEn: 'Consultation', nameAr: 'كشف', amount: o.fee ?? 300, currency: 'EGP', ...(o.depositAmount ? { depositAmount: o.depositAmount } : {}) }], payers: [] },
      clinic: { nameEn: 'Nile Clinic', nameAr: 'عيادة النيل', addressEn: '1 Street Maadi', addressAr: 'شارع ١ المعادي', latitude: o.lat ?? 29.96, longitude: o.lng ?? 31.25, phone: '+20221234567', logoUrl: null, clinicalSpecialty: o.specialty ?? 'dermatology', parking: true, wheelchairAccess: true, amenities: [], photos: [] },
    };
  }
}
