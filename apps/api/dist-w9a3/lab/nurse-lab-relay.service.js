"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
var NurseLabRelayService_1;
Object.defineProperty(exports, "__esModule", { value: true });
exports.NurseLabRelayService = void 0;
const common_1 = require("@nestjs/common");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const errors_1 = require("../common/errors");
const partners_public_1 = require("../partners/partners-public");
const lab_client_1 = require("./lab.client");
const partner_http_1 = require("../common/partner-http");
const outbox_public_1 = require("../outbox/outbox-public");
const prisma_service_1 = require("../prisma/prisma.service");
const nurse_lab_client_1 = require("./nurse-lab.client");
const PUSH = 'nurse_lab.status_push';
const RELAYED = new Set(['COLLECTED', 'IN_LAB', 'PARTIALLY_RESULTED', 'AWAITING_VALIDATION', 'VALIDATED', 'CANCELLED']);
let NurseLabRelayService = NurseLabRelayService_1 = class NurseLabRelayService {
    prisma;
    lab;
    kiorly;
    outbox;
    registry;
    labs;
    log = new common_1.Logger('nurse-lab');
    labIds = new Map();
    constructor(prisma, lab, kiorly, outbox, registry, labs) {
        this.prisma = prisma;
        this.lab = lab;
        this.kiorly = kiorly;
        this.outbox = outbox;
        this.registry = registry;
        this.labs = labs;
    }
    async labIdsOf(labRegistrationId, refresh) {
        const hit = this.labIds.get(labRegistrationId);
        if (hit && !refresh && Date.now() - hit.at < 60_000)
            return hit.ids;
        const ids = new Set((await this.labs.tests({}, labRegistrationId)).data.items.map((t) => t.labId));
        this.labIds.set(labRegistrationId, { at: Date.now(), ids });
        return ids;
    }
    async routeFor(preferredLabId) {
        const nurse = await this.registry.activeRegistrations('LAB_NURSE');
        if (!nurse.length)
            return { registrationId: null };
        const labRegs = await this.registry.activeRegistrations('LAB');
        if (nurse.length === 1 && labRegs.length <= 1)
            return { registrationId: nurse[0].id };
        if (!preferredLabId)
            return { registrationId: nurse[0].id };
        for (const refresh of [false, true]) {
            const owners = [];
            let failed = 0;
            for (const l of labRegs) {
                try {
                    if ((await this.labIdsOf(l.id, refresh)).has(preferredLabId))
                        owners.push(l.id);
                }
                catch {
                    failed++;
                }
            }
            if (owners.length > 1)
                return { refusal: 'AMBIGUOUS_LAB' };
            if (owners.length === 1) {
                const n = nurse.find((x) => x.labRegistrationId === owners[0]);
                return n ? { registrationId: n.id } : { refusal: 'LAB_NURSE_NOT_REGISTERED' };
            }
            if (refresh) {
                if (failed)
                    throw (0, errors_1.unavailable)('PARTNER_SYSTEM_BUSY', 'A lab system is busy, try again shortly', { retryable: true });
                return { refusal: 'LAB_NOT_FOUND' };
            }
        }
        return { refusal: 'LAB_NOT_FOUND' };
    }
    onModuleInit() { this.outbox.register(PUSH, (e) => this.deliverStatus(e.payload)); }
    static refusal(d) {
        if (!d.consentToken?.trim())
            return 'CONSENT_REQUIRED';
        if (!d.nurseCollection?.samples?.length || !d.nurseCollection.collectedAt || !d.nurseCollection.visitRef || !d.nurseCollection.collectorRef)
            return 'NURSE_COLLECTION_REQUIRED';
        if ((d.identifiersChecked ?? []).length < 2)
            return 'TWO_IDENTIFIERS_REQUIRED';
        if (!d.patient?.fullName || d.patient.fullName.trim().length < 2)
            return 'PATIENT_DEMOGRAPHICS_REQUIRED';
        if (!d.items?.length || d.items.some((i) => !i.code))
            return 'ITEM_CODE_REQUIRED';
        return null;
    }
    static toInbound(d, vault) {
        const c = d.nurseCollection;
        const p = d.patient;
        return {
            sourceRef: d.orderId,
            ...(d.preferredLabId ? { labId: d.preferredLabId } : {}),
            patient: { fullName: p.fullName, ...(p.dateOfBirth ? { dateOfBirth: p.dateOfBirth } : {}), ...(p.sex ? { sex: p.sex } : {}), ...(p.phone ? { phone: p.phone } : {}), ...(p.preferredLocale ? { preferredLocale: p.preferredLocale } : {}), externalId: d.patientRef },
            testCodes: d.items.map((i) => i.code),
            priority: 'ROUTINE',
            ...(d.orderingClinicianId || d.prescriberName ? { referringDoctor: { ...(d.prescriberName ? { name: d.prescriberName } : {}), ...(d.orderingClinicianId ? { ref: d.orderingClinicianId } : {}) } } : {}),
            consentChannels: vault ? ['KIORLY_NURSE_IMPORT', 'KIOREX_VAULT'] : ['KIORLY_NURSE_IMPORT'],
            identifiersChecked: d.identifiersChecked,
            nurseCollection: {
                visitRef: c.visitRef, collectorRef: c.collectorRef, ...(c.collectorName ? { collectorName: c.collectorName } : {}), collectedAt: c.collectedAt,
                ...(c.handedOverAt ? { handedOverAt: c.handedOverAt } : {}), ...(c.temperatureC != null ? { temperatureC: c.temperatureC } : {}), consentToken: d.consentToken,
                samples: c.samples.map((s) => ({ label: s.label, specimenType: s.specimenType, ...(s.container ? { container: s.container } : {}) })),
            },
        };
    }
    async vaultState(patientRef) {
        const links = await this.prisma.kiorlyPatientLink.findMany({ where: { kiorlyPatientId: patientRef, status: 'LINKED' }, select: { sub: true } });
        if (!links.length)
            return { vault: false, revoked: false };
        const revoked = await this.prisma.recordShareConsent.count({ where: { sub: { in: links.map((l) => l.sub) }, scope: 'LAB_RESULTS', granted: false } });
        return { vault: !revoked, revoked: revoked > 0 };
    }
    async onOrderPlaced(d) {
        if (d.originEdition !== 'NURSE')
            return 'IGNORED';
        const existing = await this.prisma.nurseLabRelay.findUnique({ where: { id: d.orderId } });
        if (existing)
            return 'DUPLICATE';
        const refusal = NurseLabRelayService_1.refusal(d);
        if (refusal)
            return this.refuse(d, refusal);
        const { vault, revoked } = await this.vaultState(d.patientRef);
        if (revoked)
            return this.refuse(d, 'CONSENT_REVOKED');
        const route = await this.routeFor(d.preferredLabId);
        if ('refusal' in route)
            return this.refuse(d, route.refusal);
        try {
            const { data } = await this.lab.createOrder(d.orderId, NurseLabRelayService_1.toInbound(d, vault), route.registrationId);
            await this.prisma.nurseLabRelay.upsert({
                where: { id: d.orderId },
                create: { id: d.orderId, clinicId: d.clinicId, patientRef: d.patientRef, partnerOrderId: data.orderId, registrationId: route.registrationId, labOrderNumber: data.orderNumber, status: 'SUBMITTED', lastLabStatus: data.status },
                update: {},
            });
            await this.enqueuePush(d.orderId, 'ACCEPTED', { labOrderNumber: data.orderNumber });
            return 'APPLIED';
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerHttpError && e.status !== 401 && e.status !== 403)
                return this.refuse(d, e.code ?? `LAB_${e.status}`);
            throw e;
        }
    }
    async refuse(d, code) {
        await this.prisma.nurseLabRelay.upsert({ where: { id: d.orderId }, create: { id: d.orderId, clinicId: d.clinicId, patientRef: d.patientRef, status: 'REFUSED', refusalCode: code.slice(0, 80) }, update: {} });
        await this.enqueuePush(d.orderId, 'REJECTED_BY_LAB', { rejectionCode: code });
        return 'REFUSED';
    }
    async relayFor(ids) {
        return this.prisma.nurseLabRelay.findFirst({ where: { OR: [...(ids.sourceRef ? [{ id: ids.sourceRef }] : []), ...(ids.orderId ? [{ partnerOrderId: ids.orderId }, { id: ids.orderId }] : [])] } });
    }
    async foreign(r, ctx, type) {
        if (!ctx.registrationId || !r.registrationId)
            return false;
        const owner = (await this.prisma.partnerRegistration.findUnique({ where: { id: r.registrationId }, select: { labRegistrationId: true } }))?.labRegistrationId;
        if (!owner || owner === ctx.registrationId)
            return false;
        await this.prisma.auditLog.create({ data: { actor: 'nurse_lab', action: 'nurse_lab.event_from_other_registration', resource: 'NurseLabRelay', resourceId: r.id, metadata: { type, from: ctx.registrationId, owner } } });
        return true;
    }
    async onStatusChanged(d, ctx = {}) {
        const r = await this.relayFor(d);
        if (!r)
            return 'UNKNOWN_ORDER';
        if (await this.foreign(r, ctx, 'LabOrderStatusChanged'))
            return 'IGNORED';
        if (r.status === 'REFUSED' || !d.nextStatus || !RELAYED.has(d.nextStatus))
            return 'IGNORED';
        await this.prisma.nurseLabRelay.update({ where: { id: r.id }, data: { lastLabStatus: d.nextStatus, ...(d.nextStatus === 'CANCELLED' ? { status: 'CANCELLED' } : {}) } });
        await this.enqueuePush(r.id, d.nextStatus, {});
        return 'APPLIED';
    }
    async onResultReleased(d, ctx = {}) {
        const r = await this.relayFor({ orderId: d.orderId });
        if (!r)
            return 'UNKNOWN_ORDER';
        if (await this.foreign(r, ctx, 'LabResultReleased'))
            return 'IGNORED';
        if (r.status === 'REFUSED')
            return 'IGNORED';
        await this.prisma.nurseLabRelay.update({ where: { id: r.id }, data: { status: 'RESULT_RELEASED', lastLabStatus: 'RELEASED', reportId: d.reportId } });
        await this.enqueuePush(r.id, 'RELEASED', { reportId: d.reportId, reportVersion: d.reportVersion, signedAt: d.signedAt, secureLink: d.secureLink }, `${d.reportVersion}`);
        return 'APPLIED';
    }
    enqueuePush(orderId, status, extra, discriminator = '') {
        return this.outbox.enqueue(this.prisma, { type: PUSH, aggregateType: 'NurseLabRelay', aggregateId: orderId, payload: { orderId, status, occurredAt: new Date().toISOString(), ...extra }, dedupeKey: `${PUSH}:${orderId}:${status}${discriminator ? `:${discriminator}` : ''}` });
    }
    async deliverStatus(p) {
        const r = await this.prisma.nurseLabRelay.findUnique({ where: { id: p.orderId } });
        if (!r)
            return;
        const body = { ...p };
        delete body.orderId;
        if (r.labOrderNumber)
            body.labOrderNumber = r.labOrderNumber;
        if (p.status !== 'REJECTED_BY_LAB' && r.partnerOrderId) {
            const c = await this.custody(p.orderId, r.registrationId);
            if (c) {
                body.custody = flatten(c);
                if (c.orderNumber)
                    body.labOrderNumber = c.orderNumber;
            }
        }
        try {
            await this.kiorly.pushLabOrderStatus(p.orderId, body, r.clinicId);
        }
        catch (e) {
            if (e instanceof kiorly_public_1.KiorlyHttpError && [404, 409, 422].includes(e.status)) {
                this.log.warn(`clinic refused lab status ${p.status} for ${p.orderId}: ${e.status} ${e.code ?? ''}`);
                return;
            }
            throw e;
        }
    }
    async custody(sourceRef, registrationId) {
        try {
            return (await this.lab.custody(sourceRef, registrationId)).data;
        }
        catch (e) {
            if (e instanceof partner_http_1.PartnerHttpError && e.status === 404)
                return null;
            throw e;
        }
    }
    async custodyView(orderId) {
        const r = await this.prisma.nurseLabRelay.findUnique({ where: { id: orderId } });
        if (!r?.partnerOrderId)
            return null;
        const c = await this.custody(orderId, r.registrationId);
        return c ? { orderId, status: c.status, orderNumber: c.orderNumber, custody: flatten(c) } : null;
    }
};
exports.NurseLabRelayService = NurseLabRelayService;
exports.NurseLabRelayService = NurseLabRelayService = NurseLabRelayService_1 = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, nurse_lab_client_1.NurseLabClient, kiorly_public_1.KiorlyClient, outbox_public_1.OutboxService, partners_public_1.PartnerRegistry, lab_client_1.LabClient])
], NurseLabRelayService);
function flatten(c) {
    return c.specimens.flatMap((s) => s.custody.map((e) => ({ label: s.label, type: e.type, occurredAt: e.occurredAt, by: e.by, temperatureC: e.temperatureC ?? null })));
}
//# sourceMappingURL=nurse-lab-relay.service.js.map