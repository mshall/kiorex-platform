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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RecordsService = exports.SHARE_SCOPES = void 0;
exports.isBase64Text = isBase64Text;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
const errors_1 = require("../common/errors");
const ids_1 = require("../common/ids");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const engagement_public_1 = require("../engagement/engagement-public");
const kiorly_public_1 = require("../kiorly/kiorly-public");
const outbox_public_1 = require("../outbox/outbox-public");
const patient_public_1 = require("../patient/patient-public");
const prisma_service_1 = require("../prisma/prisma.service");
const rx_1 = require("./rx");
const storage_1 = require("./storage");
exports.SHARE_SCOPES = ['VISIT_SUMMARY', 'PRESCRIPTIONS', 'LAB_RESULTS', 'SHARE_WITH_OTHER_CLINICS'];
const KIND_OF_SCOPE = { VISIT_SUMMARY: 'VISIT_SUMMARY', PRESCRIPTIONS: 'PRESCRIPTION', LAB_RESULTS: 'LAB_RESULT' };
const UPLOAD_MIME = {
    'application/pdf': (b) => b.subarray(0, 4).toString('latin1') === '%PDF',
    'image/jpeg': (b) => b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff,
    'image/png': (b) => b.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47])),
};
const FLAG_SHARING = 'clinic.record_share_patient_app';
const FLAG_VAULT = 'kiorex.record_vault';
function isBase64Text(v) {
    if (typeof v !== 'string' || v.length === 0)
        return false;
    for (let k = 0; k < v.length; k++) {
        const c = v.charCodeAt(k);
        const ok = (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 43 || c === 47 || c === 61 || c === 32 || c === 9 || c === 10 || c === 13 || c === 12 || c === 11 || c === 160 || c === 0xfeff || (c >= 0x2000 && c <= 0x200a) || c === 0x2028 || c === 0x2029 || c === 0x202f || c === 0x205f || c === 0x3000 || c === 0x1680;
        if (!ok)
            return false;
    }
    return true;
}
let RecordsService = class RecordsService {
    prisma;
    patients;
    outbox;
    kiorly;
    flags;
    engagement;
    storage;
    log = new common_1.Logger('records');
    constructor(prisma, patients, outbox, kiorly, flags, engagement, storage) {
        this.prisma = prisma;
        this.patients = patients;
        this.outbox = outbox;
        this.kiorly = kiorly;
        this.flags = flags;
        this.engagement = engagement;
        this.storage = storage;
    }
    onModuleInit() {
        this.outbox.register('kiorly.record_share_consent', (e) => this.pushConsent(e.payload));
        this.patients.registerExport('vault', async (sub) => {
            const rows = await this.prisma.sharedRecord.findMany({ where: { sub, status: 'ACTIVE' } });
            return rows.map((r) => ({ ...this.present(r), content: r.payloadEnc ? JSON.parse((0, crypto_1.decryptField)(r.payloadEnc)) : null }));
        });
        this.patients.registerAnonymizer('vault', async (sub) => { await this.deleteAllFor(sub); });
    }
    async market(sub) { return (await this.patients.profileBySub(sub))?.market ?? 'EG'; }
    async vaultWritable(sub) { return this.flags.isEnabled(FLAG_VAULT, { market: await this.market(sub) }); }
    async canGrantSharing(sub) {
        const m = await this.market(sub);
        return (await this.flags.isEnabled(FLAG_VAULT, { market: m })) && (await this.flags.isEnabled(FLAG_SHARING, { market: m }));
    }
    present(r) {
        return {
            id: r.id, kind: r.kind, title: r.title, source: r.kind === 'UPLOAD' ? 'PATIENT' : r.kind === 'LAB_RESULT' ? 'LAB' : 'CLINIC', clinicId: r.clinicId, dependantId: r.dependantId, signedAt: r.signedAt?.toISOString() ?? null,
            hasFile: !!r.storageKey, fileName: r.fileName, mimeType: r.mimeType, sizeBytes: r.sizeBytes, createdAt: r.createdAt.toISOString(),
        };
    }
    async list(sub, kind) {
        const rows = await this.prisma.sharedRecord.findMany({ where: { sub, status: 'ACTIVE', ...(kind ? { kind } : {}) }, orderBy: [{ signedAt: 'desc' }, { createdAt: 'desc' }], take: 200 });
        return { items: rows.map((r) => this.present(r)), readOnly: !(await this.vaultWritable(sub)) };
    }
    async owned(sub, id) {
        const r = await this.prisma.sharedRecord.findUnique({ where: { id } });
        if (!r || r.sub !== sub || r.status !== 'ACTIVE')
            throw (0, errors_1.notFound)('RECORD_NOT_FOUND', 'Record not found');
        return r;
    }
    async detail(sub, id) {
        const r = await this.owned(sub, id);
        const base = this.present(r);
        const content = r.payloadEnc ? JSON.parse((0, crypto_1.decryptField)(r.payloadEnc)) : undefined;
        if (r.kind === 'VISIT_SUMMARY')
            return { ...base, content };
        if (r.kind === 'LAB_RESULT')
            return { ...base, report: content };
        if (r.kind === 'PRESCRIPTION')
            return { ...base, prescription: { encounterId: content?.encounterId ?? r.sourceRef, clinicId: r.clinicId, items: content?.items ?? null, itemsAvailable: Array.isArray(content?.items) }, verification: this.verification(r) };
        return base;
    }
    verification(r) {
        const token = (0, rx_1.rxToken)(r.id, r.signedAt ?? r.createdAt);
        return { token, qrPayload: (0, rx_1.rxQrPayload)(token), verifyUrl: (0, rx_1.rxVerifyUrl)(token) };
    }
    async prescriptionForOrder(sub, recordId) {
        const r = await this.owned(sub, recordId);
        if (r.kind !== 'PRESCRIPTION')
            throw (0, errors_1.badRequest)('NOT_A_PRESCRIPTION', 'Record is not a prescription');
        return { id: r.id, clinicId: r.clinicId, verificationToken: this.verification(r).token };
    }
    async prescriptions(sub) {
        const rows = await this.prisma.sharedRecord.findMany({ where: { sub, kind: 'PRESCRIPTION', status: 'ACTIVE' }, orderBy: { createdAt: 'desc' }, take: 100 });
        return rows.map((r) => ({ ...this.present(r), verification: this.verification(r) }));
    }
    async verifyRx(token) {
        const p = (0, rx_1.parseRxToken)(token);
        if (!p)
            return { valid: false, status: 'UNKNOWN' };
        const r = await this.prisma.sharedRecord.findUnique({ where: { id: p.recordId } });
        if (!r || r.kind !== 'PRESCRIPTION' || !(0, rx_1.rxTokenValid)(r.id, r.signedAt ?? r.createdAt, p.mac))
            return { valid: false, status: 'UNKNOWN' };
        if (r.status !== 'ACTIVE')
            return { valid: false, status: 'REVOKED' };
        return { valid: true, status: 'ACTIVE', clinicId: r.clinicId ?? undefined, signedAt: (r.signedAt ?? r.createdAt).toISOString() };
    }
    async upload(sub, i) {
        const check = UPLOAD_MIME[i.mimeType];
        if (!check)
            throw (0, errors_1.badRequest)('UNSUPPORTED_FILE_TYPE', 'Only PDF, JPEG and PNG files can be uploaded', { allowed: Object.keys(UPLOAD_MIME) });
        if (!isBase64Text(i.contentBase64))
            throw (0, errors_1.badRequest)('INVALID_CONTENT', 'contentBase64 must be base64');
        const buf = Buffer.from(i.contentBase64, 'base64');
        if (!buf.length)
            throw (0, errors_1.badRequest)('EMPTY_FILE', 'File is empty');
        if (buf.length > (0, config_1.cfg)().vaultMaxBytes)
            throw (0, errors_1.badRequest)('FILE_TOO_LARGE', `Max ${(0, config_1.cfg)().vaultMaxBytes} bytes`, { maxBytes: (0, config_1.cfg)().vaultMaxBytes });
        if (!check(buf))
            throw (0, errors_1.badRequest)('MIME_MISMATCH', 'File content does not match its declared type');
        const id = (0, ids_1.newId)('kx_rec');
        const key = `${(0, node_crypto_1.createHash)('sha1').update(sub).digest('hex').slice(0, 12)}/${id}`;
        await this.storage.put(key, buf);
        const name = i.fileName.replace(/[\\/\0]/g, '_').slice(0, 120);
        const r = await this.prisma.sharedRecord.create({ data: { id, sub, kind: 'UPLOAD', title: (i.title ?? name).slice(0, 120), storageKey: key, fileName: name, mimeType: i.mimeType, sizeBytes: buf.length, sha256: (0, crypto_1.sha256Hex)(buf), signedAt: null } });
        return this.present(r);
    }
    async content(sub, id) {
        const r = await this.owned(sub, id);
        if (!r.storageKey)
            throw (0, errors_1.notFound)('NO_FILE', 'This record has no file');
        return { bytes: await this.storage.get(r.storageKey), mimeType: r.mimeType ?? 'application/octet-stream', fileName: r.fileName ?? 'file' };
    }
    async remove(sub, id) {
        const r = await this.owned(sub, id);
        await this.purge(r, 'PATIENT_DELETED');
        return { ok: true };
    }
    async purge(r, reason) {
        if (r.storageKey)
            await this.storage.delete(r.storageKey).catch(() => undefined);
        await this.prisma.sharedRecord.update({ where: { id: r.id }, data: { status: 'REVOKED', revokedAt: new Date(), revokedReason: reason, payloadEnc: null, storageKey: null, fileName: null, sha256: null, title: null } });
        await this.cancelFollowUpsForRecord(r.id);
    }
    async deleteAllFor(sub) {
        for (const r of await this.prisma.sharedRecord.findMany({ where: { sub, status: 'ACTIVE' } }))
            await this.purge(r, 'ACCOUNT_DELETED');
        await this.prisma.recordShareConsent.deleteMany({ where: { sub } });
    }
    async sharing(sub) {
        const rows = await this.prisma.recordShareConsent.findMany({ where: { sub } });
        return { scopes: exports.SHARE_SCOPES.map((scope) => { const r = rows.find((x) => x.scope === scope); return { scope, granted: !!r?.granted, updatedAt: r?.updatedAt.toISOString() ?? null }; }), canGrant: await this.canGrantSharing(sub) };
    }
    async setSharing(sub, scope, granted) {
        if (!exports.SHARE_SCOPES.includes(scope))
            throw (0, errors_1.badRequest)('UNKNOWN_SCOPE', 'Unknown record-share scope', { allowed: exports.SHARE_SCOPES });
        const m = await this.market(sub);
        if (granted) {
            await this.flags.assertEnabled(FLAG_VAULT, { market: m });
            await this.flags.assertEnabled(FLAG_SHARING, { market: m });
        }
        await this.prisma.recordShareConsent.upsert({ where: { sub_scope: { sub, scope } }, create: { sub, scope, granted }, update: { granted } });
        const any = await this.prisma.recordShareConsent.count({ where: { sub, granted: true } });
        await this.patients.setConsent(sub, 'RECORD_SHARING', any > 0, 'vault');
        if (!granted)
            await this.deleteScopeCopies(sub, scope, 'REVOKED_BY_PATIENT');
        const links = await this.prisma.kiorlyPatientLink.findMany({ where: { sub, status: 'LINKED' } });
        for (const l of links) {
            await this.outbox.enqueue(this.prisma, { type: 'kiorly.record_share_consent', target: 'KIORLY', aggregateType: 'RecordShareConsent', aggregateId: `${sub}:${l.kiorlyPatientId}`, payload: { kiorlyPatientId: l.kiorlyPatientId, clinicId: l.clinicId, scope, granted }, dedupeKey: `kiorly.record_share_consent:${l.kiorlyPatientId}:${scope}:${granted}:${Date.now()}` });
        }
        return this.sharing(sub);
    }
    async pushConsent(p) {
        try {
            await this.kiorly.upsertRecordShareConsents(p.kiorlyPatientId, [{ scope: p.scope, granted: p.granted }], p.clinicId);
        }
        catch (err) {
            if (!(err instanceof kiorly_public_1.KiorlyHttpError) || err.status !== 404)
                throw err;
            await this.prisma.kiorlyPatientLink.updateMany({ where: { kiorlyPatientId: p.kiorlyPatientId, ...(p.clinicId ? { clinicId: p.clinicId } : {}), status: 'LINKED' }, data: { status: 'STALE' } });
            this.log.warn(`record-share consent push skipped: Kiorly patient ${p.kiorlyPatientId} not found, link marked STALE`);
        }
    }
    async deleteScopeCopies(sub, scope, reason) {
        const kind = KIND_OF_SCOPE[scope];
        if (!kind)
            return 0;
        const rows = await this.prisma.sharedRecord.findMany({ where: { sub, kind, status: 'ACTIVE' } });
        for (const r of rows)
            await this.purge(r, reason);
        return rows.length;
    }
    static redactEnvelope(env) {
        const d = env?.data;
        if (!d)
            return env;
        if (/^telehealth\./i.test(env.type) || d.telehealth) {
            const strip = (o) => (o && typeof o === 'object' ? Object.fromEntries(Object.entries(o).map(([k, v]) => [k, /^(joinUrl|patientJoinUrl|token)$/i.test(k) && v ? '[REDACTED]' : v])) : o);
            return { ...env, data: { ...strip(d), ...(d.telehealth ? { telehealth: strip(d.telehealth) } : {}) } };
        }
        if (/^(HOME_VISIT_|SAFETY_ALERT_|CARE_PLAN_)/.test(env.type))
            return { ...env, data: Object.fromEntries(Object.entries(d).filter(([k]) => !/^(visitAddress|address|line1|lat|lng|latitude|longitude|geostamp|phone|mobile|email)$/i.test(k))) };
        if (env.type === 'LabOrderPlaced')
            return { ...env, data: { ...d, consentToken: d.consentToken ? '[REDACTED]' : undefined, patient: d.patient ? '[REDACTED]' : undefined, identifiersChecked: d.identifiersChecked ? '[REDACTED]' : undefined, nurseCollection: d.nurseCollection ? { collectedAt: d.nurseCollection.collectedAt, samples: d.nurseCollection.samples ? d.nurseCollection.samples.length : 0 } : undefined } };
        if (env.type === 'VISIT_SUMMARY_SHARED')
            return { ...env, data: { ...d, summary: d.summary ? { encounterId: d.summary.encounterId, clinicId: d.summary.clinicId, signedAt: d.summary.signedAt, soap: '[REDACTED]' } : undefined } };
        if (env.type === 'PRESCRIPTION_SHARED')
            return { ...env, data: { ...d, items: d.items ? '[REDACTED]' : undefined } };
        return env;
    }
    async subsFor(kiorlyPatientId) {
        return this.prisma.kiorlyPatientLink.findMany({ where: { kiorlyPatientId, status: 'LINKED' } });
    }
    async intakeAllowed(sub) {
        const m = await this.market(sub);
        return (await this.flags.isEnabled(FLAG_VAULT, { market: m })) && (await this.flags.isEnabled(FLAG_SHARING, { market: m }));
    }
    async patientRevokedLocally(sub, scope) {
        const c = await this.prisma.recordShareConsent.findUnique({ where: { sub_scope: { sub, scope } } });
        return !!c && !c.granted;
    }
    async onKiorlyEvent(env) {
        const d = env.data;
        if (env.type === 'RECORD_SHARE_REVOKED')
            return this.onRevoked(d);
        const links = await this.subsFor(String(d.patientId ?? ''));
        if (!links.length)
            return 'UNMAPPED_PATIENT';
        if (env.type === 'VISIT_SUMMARY_SHARED') {
            const expect = (0, node_crypto_1.createHmac)('sha256', (0, config_1.cfg)().recordShareSecret).update(JSON.stringify(d.summary ?? null), 'utf8').digest('hex');
            if (!d.summary || typeof d.signature !== 'string' || !(0, crypto_1.safeEqual)(expect, d.signature)) {
                await this.prisma.auditLog.create({ data: { actor: 'kiorly', action: 'records.invalid_signature', resource: 'WebhookReceipt', resourceId: env.eventId ?? null } });
                return 'IGNORED';
            }
        }
        let applied = false;
        for (const l of links) {
            const scope = env.type === 'PRESCRIPTION_SHARED' ? 'PRESCRIPTIONS' : 'VISIT_SUMMARY';
            if (!(await this.intakeAllowed(l.sub)))
                continue;
            if (await this.patientRevokedLocally(l.sub, scope))
                continue;
            if (env.type === 'VISIT_SUMMARY_SHARED')
                await this.storeVisitSummary(l, d, env.eventId);
            else
                await this.storePrescription(l, d, env.eventId);
            applied = true;
        }
        return applied ? 'APPLIED' : 'IGNORED';
    }
    async upsertRecord(l, kind, sourceRef, data) {
        const where = { sub_kind_sourceRef: { sub: l.sub, kind, sourceRef } };
        const fields = { clinicId: l.clinicId, kiorlyPatientId: l.kiorlyPatientId, dependantId: l.dependantId, title: data.title, payloadEnc: (0, crypto_1.encryptField)(JSON.stringify(data.payload)), signedAt: data.signedAt, sourceEventId: data.eventId, status: 'ACTIVE', revokedAt: null, revokedReason: null };
        const existing = await this.prisma.sharedRecord.findUnique({ where });
        const rec = existing
            ? await this.prisma.sharedRecord.update({ where, data: fields })
            : await this.prisma.sharedRecord.create({ data: { id: (0, ids_1.newId)('kx_rec'), sub: l.sub, kind, sourceRef, ...fields } });
        return { rec, isNew: !existing || existing.status !== 'ACTIVE' };
    }
    async storeVisitSummary(l, d, eventId) {
        const s = d.summary;
        const { rec, isNew } = await this.upsertRecord(l, 'VISIT_SUMMARY', String(s.encounterId), { title: 'Visit summary', payload: { encounterId: s.encounterId, soap: s.soap }, signedAt: s.signedAt ? new Date(s.signedAt) : null, eventId });
        const days = Number(s.followUp?.intervalDays ?? s.followUpDays);
        if (Number.isInteger(days) && days >= 1 && days <= 730 && isNew)
            await this.createFollowUp({ sub: l.sub, recordId: rec.id, clinicId: l.clinicId, afterDays: days, source: 'DOCTOR', from: rec.signedAt ?? new Date() });
        if (isNew)
            await this.engagement.notify(l.sub, { kind: 'RECORD_SHARED', dedupeKey: `RECORD_SHARED:${rec.id}:${rec.updatedAt.getTime()}` });
    }
    async storePrescription(l, d, eventId) {
        const { rec, isNew } = await this.upsertRecord(l, 'PRESCRIPTION', String(d.encounterId), { title: 'Prescription', payload: { encounterId: d.encounterId, clinicId: d.clinicId, items: Array.isArray(d.items) ? d.items : undefined }, signedAt: d.signedAt ? new Date(d.signedAt) : null, eventId });
        if (isNew)
            await this.engagement.notify(l.sub, { kind: 'RECORD_SHARED', dedupeKey: `RECORD_SHARED:${rec.id}:${rec.updatedAt.getTime()}` });
    }
    async onRevoked(d) {
        const links = await this.subsFor(String(d.patientId ?? ''));
        if (!links.length)
            return 'UNMAPPED_PATIENT';
        const scope = d.scope;
        if (!exports.SHARE_SCOPES.includes(scope))
            return 'IGNORED';
        for (const l of links) {
            await this.prisma.recordShareConsent.upsert({ where: { sub_scope: { sub: l.sub, scope } }, create: { sub: l.sub, scope, granted: false }, update: { granted: false } });
            await this.deleteScopeCopies(l.sub, scope, 'REVOKED_IN_KIORLY');
        }
        return 'APPLIED';
    }
    async storeLabResult(i) {
        let target = null;
        const profile = await this.prisma.patientProfile.findUnique({ where: { sub: i.patientRef } });
        if (profile)
            target = { sub: profile.sub, clinicId: i.labId, kiorlyPatientId: '', dependantId: null };
        else {
            const l = (await this.subsFor(i.patientRef))[0];
            if (l)
                target = l;
        }
        if (!target)
            return 'UNMAPPED_PATIENT';
        if (i.channels && !i.channels.includes('KIOREX_VAULT'))
            return 'IGNORED';
        if (!(await this.vaultWritable(target.sub)))
            return 'IGNORED';
        if (await this.patientRevokedLocally(target.sub, 'LAB_RESULTS'))
            return 'IGNORED';
        const { rec, isNew } = await this.upsertRecord({ ...target, clinicId: i.labId }, 'LAB_RESULT', i.reportId, { title: 'Lab report', payload: { reportId: i.reportId, orderId: i.orderId, labId: i.labId, reportVersion: i.reportVersion, secureLink: i.secureLink }, signedAt: new Date(i.signedAt) });
        await this.engagement.notify(target.sub, { kind: 'LAB_RESULT_RELEASED', dedupeKey: `LAB_RESULT_RELEASED:${rec.id}:${i.reportVersion}` });
        void isNew;
        return 'APPLIED';
    }
    async createFollowUp(i) {
        const due = i.dueAt ?? new Date((i.from ?? new Date()).getTime() + (i.afterDays ?? 0) * 86400_000);
        if (!(i.afterDays && i.afterDays >= 1 && i.afterDays <= 730) && !i.dueAt)
            throw (0, errors_1.badRequest)('INVALID_INTERVAL', 'afterDays must be 1-730');
        if (i.recordId)
            await this.owned(i.sub, i.recordId);
        const f = await this.prisma.followUpReminder.create({ data: { id: (0, ids_1.newId)('kx_fu'), sub: i.sub, recordId: i.recordId, clinicId: i.clinicId, dueAt: due, source: i.source } });
        await this.engagement.notify(i.sub, { kind: 'FOLLOW_UP_DUE', bookingId: f.id, scheduledFor: due, dedupeKey: `FOLLOW_UP_DUE:${f.id}` });
        return this.presentFollowUp(f);
    }
    presentFollowUp(f) {
        return { id: f.id, recordId: f.recordId, clinicId: f.clinicId, dueAt: f.dueAt.toISOString(), source: f.source, status: f.status === 'CANCELLED' ? 'CANCELLED' : f.dueAt <= new Date() ? 'DUE' : 'SCHEDULED' };
    }
    async followUps(sub) {
        const rows = await this.prisma.followUpReminder.findMany({ where: { sub, status: { not: 'CANCELLED' } }, orderBy: { dueAt: 'asc' }, take: 100 });
        return rows.map((f) => this.presentFollowUp(f));
    }
    async cancelFollowUp(sub, id) {
        const r = await this.prisma.followUpReminder.updateMany({ where: { id, sub, status: { not: 'CANCELLED' } }, data: { status: 'CANCELLED' } });
        if (!r.count)
            throw (0, errors_1.notFound)('FOLLOW_UP_NOT_FOUND', 'Follow-up not found');
        await this.engagement.cancelBookingMessages(id);
        return { ok: true };
    }
    async cancelFollowUpsForRecord(recordId) {
        const rows = await this.prisma.followUpReminder.findMany({ where: { recordId, status: { not: 'CANCELLED' } } });
        for (const f of rows) {
            await this.prisma.followUpReminder.update({ where: { id: f.id }, data: { status: 'CANCELLED' } });
            await this.engagement.cancelBookingMessages(f.id);
        }
    }
    async followUpForOwner(sub, recordId, afterDays) {
        const r = await this.owned(sub, recordId);
        return this.createFollowUp({ sub, recordId, clinicId: r.clinicId ?? undefined, afterDays, source: 'PATIENT' });
    }
};
exports.RecordsService = RecordsService;
exports.RecordsService = RecordsService = __decorate([
    (0, common_1.Injectable)(),
    __param(6, (0, common_1.Inject)(storage_1.STORAGE)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, patient_public_1.PatientService, outbox_public_1.OutboxService, kiorly_public_1.KiorlyClient,
        control_plane_public_1.FlagsService, engagement_public_1.EngagementService, Object])
], RecordsService);
//# sourceMappingURL=records.service.js.map