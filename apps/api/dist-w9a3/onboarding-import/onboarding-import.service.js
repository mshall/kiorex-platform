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
exports.OnboardingImportService = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const prisma_service_1 = require("../prisma/prisma.service");
const adapters_1 = require("./adapters");
const analyzer_1 = require("./lib/analyzer");
const csv_1 = require("./lib/csv");
const encoding_1 = require("./lib/encoding");
const file_scan_1 = require("./lib/file-scan");
const mapper_1 = require("./lib/mapper");
const sql_parser_1 = require("./lib/sql-parser");
const xlsx_1 = require("./lib/xlsx");
const err = (E, code, extra = {}) => new E({ code, message: code, ...extra });
const MAX_FILES_PER_BATCH = 500;
const COMMIT_CHUNK = { patients: 100, appointments: 200, visits: 200, billing: 200, documents: 2 };
let OnboardingImportService = class OnboardingImportService {
    prisma;
    store;
    scanner;
    target;
    log = new common_1.Logger('onboarding-import');
    constructor(prisma, store, scanner, target) {
        this.prisma = prisma;
        this.store = store;
        this.scanner = scanner;
        this.target = target;
    }
    audit(actor, action, batchId, metadata) { return this.prisma.auditLog.create({ data: { actor, action: `onboarding.${action}`, resource: 'ImportBatch', resourceId: batchId, metadata: metadata } }); }
    async batch(id) { const b = await this.prisma.importBatch.findUnique({ where: { id } }); if (!b)
        throw err(common_1.NotFoundException, 'IMPORT_NOT_FOUND'); return b; }
    assertEditable(status) { if (!['DRAFT', 'NEEDS_REVIEW', 'READY', 'AWAITING_APPROVAL', 'APPROVED'].includes(status))
        throw err(common_1.ConflictException, 'IMPORT_LOCKED', { status }); }
    async create(u, b) {
        const row = await this.prisma.importBatch.create({ data: { orgId: b.orgId, orgName: b.orgName, label: b.label, createdBy: u.sub } });
        await this.audit(u.sub, 'batch_created', row.id, { orgId: b.orgId });
        return this.view(row);
    }
    view(b) { const { summary, progress, ...rest } = b; return { ...rest, summary: summary ?? null, progress: progress ?? null }; }
    async list() { return (await this.prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })).map((b) => this.view(b)); }
    async get(id) { const b = await this.batch(id); const files = await this.prisma.importFile.findMany({ where: { batchId: id }, select: { id: true, name: true, kind: true, rejectReason: true, size: true, sha256: true, meta: true, createdAt: true }, orderBy: { createdAt: 'asc' } }); return { ...this.view(b), files }; }
    async addFile(u, batchId, name, contentBase64) {
        const b = await this.batch(batchId);
        this.assertEditable(b.status);
        if ((await this.prisma.importFile.count({ where: { batchId } })) >= MAX_FILES_PER_BATCH)
            throw err(common_1.BadRequestException, 'IMPORT_TOO_MANY_FILES');
        const safeName = name.replace(/[\\/\0]/g, '_').slice(0, 200);
        const compact = contentBase64.replace(/\s+/g, '');
        if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1)
            throw err(common_1.BadRequestException, 'IMPORT_BAD_BASE64');
        const bytes = Buffer.from(compact, 'base64');
        const v = await (0, file_scan_1.scanUpload)(safeName, bytes, this.scanner);
        const fileId = (0, node_crypto_1.randomUUID)();
        if (!v.ok) {
            const row = await this.prisma.importFile.create({ data: { id: fileId, batchId, name: safeName, kind: 'REJECTED', rejectReason: v.reason, sha256: v.sha256, size: bytes.length, sniffed: v.sniffed } });
            this.log.warn(`file rejected batch=${batchId} file=${fileId} reason=${v.reason} size=${bytes.length}`);
            await this.audit(u.sub, 'file_rejected', batchId, { fileId, reason: v.reason });
            await this.reanalyze(batchId);
            return { id: row.id, kind: 'REJECTED', rejectReason: v.reason };
        }
        const storageKey = await this.store.put(batchId, fileId, bytes);
        let tables = null;
        let meta = null;
        try {
            if (v.cls === 'SQL') {
                const d = (0, encoding_1.decodeText)(bytes);
                const r = (0, sql_parser_1.parseSqlDump)(d.text);
                tables = r.tables;
                meta = { dialect: r.dialect, statements: r.statements, skipped: r.skipped, dangerous: r.dangerous, encoding: d.encoding, encodingIssues: d.issues };
            }
            else if (v.cls === 'CSV') {
                const d = (0, encoding_1.decodeText)(bytes);
                tables = [(0, csv_1.parseCsv)(d.text, safeName.replace(/\.[^.]+$/, ''))];
                meta = { encoding: d.encoding, encodingIssues: d.issues };
            }
            else if (v.cls === 'XLSX')
                tables = (0, xlsx_1.parseXlsx)(bytes, safeName.replace(/\.[^.]+$/, ''));
        }
        catch (e) {
            await this.prisma.importFile.create({ data: { id: fileId, batchId, name: safeName, kind: 'REJECTED', rejectReason: 'UNPARSEABLE', sha256: v.sha256, size: bytes.length, sniffed: v.sniffed, storageKey } });
            this.log.warn(`parse failed batch=${batchId} file=${fileId} err=${e.name}`);
            await this.reanalyze(batchId);
            return { id: fileId, kind: 'REJECTED', rejectReason: 'UNPARSEABLE' };
        }
        await this.prisma.importFile.create({ data: { id: fileId, batchId, name: safeName, kind: v.cls, sha256: v.sha256, size: bytes.length, sniffed: v.sniffed, storageKey, tables: tables, meta: meta } });
        this.log.log(`file staged batch=${batchId} file=${fileId} kind=${v.cls} size=${bytes.length}`);
        await this.audit(u.sub, 'file_staged', batchId, { fileId, kind: v.cls, size: bytes.length });
        await this.reanalyze(batchId);
        return { id: fileId, kind: v.cls };
    }
    async run(batchId) {
        const files = await this.prisma.importFile.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } });
        const tables = [];
        const staged = [];
        const unsafe = [];
        for (const f of files) {
            if (f.tables)
                for (const t of f.tables)
                    tables.push({ fileId: f.id, table: t });
            if (f.meta?.dangerous?.length)
                unsafe.push(...f.meta.dangerous);
            if (f.kind === 'PATIENT_FILE')
                staged.push({ fileId: f.id, name: f.name, sha256: f.sha256, size: f.size, kind: 'PATIENT_FILE' });
            else if (f.kind === 'REJECTED')
                staged.push({ fileId: f.id, name: f.name, sha256: f.sha256, size: f.size, kind: 'REJECTED', rejectReason: f.rejectReason ?? undefined });
        }
        const decisions = (await this.prisma.importDecision.findMany({ where: { batchId } })).map((d) => ({ taskKey: d.taskKey, action: d.action, params: d.params ?? undefined, reason: d.reason ?? undefined }));
        return (0, analyzer_1.analyze)({ tables, files: staged, decisions, unsafe: [...new Set(unsafe)] });
    }
    async reanalyze(batchId) {
        const b = await this.batch(batchId);
        if (!['DRAFT', 'NEEDS_REVIEW', 'READY', 'AWAITING_APPROVAL', 'APPROVED'].includes(b.status))
            return;
        const a = await this.run(batchId);
        const existing = new Map((await this.prisma.importTask.findMany({ where: { batchId } })).map((t) => [t.key, t]));
        const decided = new Set((await this.prisma.importDecision.findMany({ where: { batchId }, select: { taskKey: true } })).map((d) => d.taskKey));
        const seen = new Set();
        await this.prisma.$transaction(async (tx) => {
            for (const t of a.tasks) {
                seen.add(t.key);
                const data = { type: t.type, severity: t.severity, entity: t.entity ?? null, status: t.status, payload: t };
                await tx.importTask.upsert({ where: { batchId_key: { batchId, key: t.key } }, create: { batchId, key: t.key, ...data }, update: data });
            }
            for (const [key, row] of existing)
                if (!seen.has(key)) {
                    if (decided.has(key) || ['RESOLVED', 'IGNORED'].includes(row.status))
                        await tx.importTask.update({ where: { id: row.id }, data: { status: row.status === 'OPEN' ? 'RESOLVED' : row.status, payload: { ...row.payload, status: row.status === 'OPEN' ? 'RESOLVED' : row.status } } });
                    else
                        await tx.importTask.delete({ where: { id: row.id } });
                }
        });
        const status = a.stats.blockers ? 'NEEDS_REVIEW' : (a.stats.rows.patients || a.stats.filesTotal) ? 'READY' : 'DRAFT';
        const hash = this.reportHash(a);
        const keep = b.reportHash === hash && ['AWAITING_APPROVAL', 'APPROVED'].includes(b.status) && !a.stats.blockers;
        await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: keep ? b.status : status, ...(keep ? {} : { requestedBy: null, requestedAt: null, reportHash: null, approvedBy: null, approvedAt: null }), summary: { classification: a.classification, mappings: a.mappings, stats: a.stats } } });
        return a;
    }
    async tasks(batchId, q) {
        await this.batch(batchId);
        const pageSize = Math.min(q.pageSize ?? 50, 200);
        const page = Math.max(q.page ?? 1, 1);
        const where = { batchId, ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}), ...(q.type ? { type: q.type } : {}) };
        const [total, rows] = await Promise.all([this.prisma.importTask.count({ where }), this.prisma.importTask.findMany({ where, orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })]);
        const counts = await this.prisma.importTask.groupBy({ by: ['status', 'severity'], where: { batchId }, _count: true });
        return { total, page, pageSize, counts: counts.map((c) => ({ status: c.status, severity: c.severity, count: c._count })), items: rows.map((r) => ({ id: r.id, ...r.payload, status: r.status, resolvedBy: r.resolvedBy })) };
    }
    async resolve(u, batchId, taskId, body) {
        const b = await this.batch(batchId);
        this.assertEditable(b.status);
        const row = await this.prisma.importTask.findFirst({ where: { id: taskId, batchId } });
        if (!row)
            throw err(common_1.NotFoundException, 'TASK_NOT_FOUND');
        const t = row.payload;
        if (!t.actions.includes(body.action))
            throw err(common_1.BadRequestException, 'ACTION_NOT_ALLOWED', { allowed: t.actions });
        if (body.action === 'IGNORE' && !(body.reason && body.reason.trim().length >= 3))
            throw err(common_1.BadRequestException, 'IGNORE_REASON_REQUIRED');
        this.validateParams(t, body);
        const key = body.action === 'SKIP_ROW' && t.type !== 'DUPLICATE_PATIENT' && t.entity && t.ref?.sourceKey ? `skip:${t.entity}:${t.ref.sourceKey}` : body.action === 'CHOOSE_DATE_FORMAT' ? 'fmt:dayFirst' : body.action === 'MAP_COLUMN' && t.entity ? `map:${t.entity}:${t.ref?.field}` : body.action === 'MAP_TABLE' ? `table:${t.ref?.table}` : body.action === 'ACCEPT_REPAIR' ? t.key : t.key;
        const params = body.action === 'CHOOSE_DATE_FORMAT' ? { dayFirst: body.params?.dayFirst !== false } : body.params;
        await this.prisma.importDecision.upsert({ where: { batchId_taskKey: { batchId, taskKey: key } }, create: { batchId, taskKey: key, action: body.action, params: params, reason: body.reason, decidedBy: u.sub }, update: { action: body.action, params: params, reason: body.reason, decidedBy: u.sub } });
        if (key !== t.key && body.action !== 'MAP_COLUMN' && body.action !== 'MAP_TABLE' && body.action !== 'CHOOSE_DATE_FORMAT')
            await this.prisma.importDecision.upsert({ where: { batchId_taskKey: { batchId, taskKey: t.key } }, create: { batchId, taskKey: t.key, action: body.action, params: params, reason: body.reason, decidedBy: u.sub }, update: { action: body.action, params: params, reason: body.reason, decidedBy: u.sub } });
        await this.prisma.importTask.update({ where: { id: row.id }, data: { resolvedBy: u.sub } });
        await this.audit(u.sub, 'task_resolved', batchId, { taskType: t.type, action: body.action, severity: t.severity });
        await this.reanalyze(batchId);
        return this.tasks(batchId, { status: 'OPEN', pageSize: 1 }).then((r) => ({ ok: true, open: r.total }));
    }
    async resolveMany(u, batchId, ids, body) {
        if (ids.length > 500)
            throw err(common_1.BadRequestException, 'TOO_MANY_TASKS');
        let n = 0;
        for (const id of ids) {
            try {
                await this.resolve(u, batchId, id, body);
                n++;
            }
            catch (e) {
                if (e?.getStatus?.() !== 404)
                    throw e;
            }
        }
        return { ok: true, resolved: n };
    }
    validateParams(t, b) {
        const p = b.params ?? {};
        if (b.action === 'EDIT_VALUE' && (typeof p.value !== 'string' || p.value.length > 500))
            throw err(common_1.BadRequestException, 'VALUE_REQUIRED');
        if (b.action === 'MAP_COLUMN' && !(typeof p.column === 'string' && (t.context.columns ? t.context.columns.includes(p.column) : true)))
            throw err(common_1.BadRequestException, 'COLUMN_REQUIRED');
        if (b.action === 'MAP_TABLE' && p.entity !== null && !mapper_1.ENTITIES.includes(p.entity))
            throw err(common_1.BadRequestException, 'ENTITY_REQUIRED');
        if (b.action === 'ASSIGN_FILE' || b.action === 'ASSIGN_PATIENT') {
            if (typeof p.sourceKey !== 'string')
                throw err(common_1.BadRequestException, 'PATIENT_REQUIRED');
        }
        if (b.action === 'MERGE' && p.keep !== undefined && typeof p.keep !== 'string')
            throw err(common_1.BadRequestException, 'KEEP_REQUIRED');
    }
    async patientsLookup(batchId, q) {
        const a = await this.run(batchId);
        const s = q.trim().toLowerCase();
        return a.records.patients.filter((p) => !s || p.sourceKey.toLowerCase().includes(s) || String(p.data.fullName ?? '').toLowerCase().includes(s) || String(p.data.phone ?? '').includes(s)).slice(0, 20).map((p) => ({ sourceKey: p.sourceKey, name: p.data.fullName, phone: p.data.phone }));
    }
    reportHash(a) {
        const canon = JSON.stringify({ r: mapper_1.ENTITIES.map((e) => [e, a.records[e].map((x) => [x.sourceKey, x.data])]), l: a.fileLinks.map((l) => [l.fileId, l.patientSourceKey]) });
        return (0, node_crypto_1.createHash)('sha256').update(canon).digest('hex');
    }
    async dryRun(batchId) {
        const b = await this.batch(batchId);
        const a = ['COMMITTED', 'ROLLED_BACK', 'COMMITTING', 'COMMIT_FAILED', 'ROLLING_BACK'].includes(b.status) ? null : await this.run(batchId);
        if (!a)
            return { batchId, status: b.status, progress: b.progress };
        const tasks = await this.prisma.importTask.groupBy({ by: ['type', 'status'], where: { batchId }, _count: true });
        const open = a.tasks.filter((t) => t.status === 'OPEN');
        return {
            batchId, status: b.status, orgId: b.orgId, orgName: b.orgName, reportHash: this.reportHash(a), canCommit: open.every((t) => t.severity !== 'BLOCKER') && a.stats.rows.patients > 0,
            willCreate: a.stats.rows, filesToAttach: a.stats.filesMatched, mergedPatients: a.stats.mergedPatients, skippedFiles: a.skippedFiles.length,
            openBlockers: open.filter((t) => t.severity === 'BLOCKER').length, openWarnings: open.filter((t) => t.severity === 'WARNING').length,
            ignoredWithReason: a.tasks.filter((t) => t.status === 'IGNORED').length, taskBreakdown: tasks.map((t) => ({ type: t.type, status: t.status, count: t._count })),
            targetMode: this.target.mode,
        };
    }
    async requestCommit(u, batchId) {
        const b = await this.batch(batchId);
        if (!['READY', 'AWAITING_APPROVAL'].includes(b.status))
            throw err(common_1.ConflictException, 'IMPORT_NOT_READY', { status: b.status });
        const r = await this.dryRun(batchId);
        if (!r.canCommit)
            throw err(common_1.ConflictException, 'BLOCKERS_OPEN', { blockers: r.openBlockers });
        await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'AWAITING_APPROVAL', requestedBy: u.sub, requestedAt: new Date(), reportHash: r.reportHash, approvedBy: null, approvedAt: null } });
        await this.audit(u.sub, 'commit_requested', batchId, { reportHash: r.reportHash, willCreate: r.willCreate });
        return { ok: true, reportHash: r.reportHash };
    }
    async approve(u, batchId, reportHash) {
        const b = await this.batch(batchId);
        if (b.status !== 'AWAITING_APPROVAL')
            throw err(common_1.ConflictException, 'NOT_AWAITING_APPROVAL', { status: b.status });
        if (u.sub === b.requestedBy || u.sub === b.createdBy)
            throw err(common_1.ForbiddenException, 'TWO_PERSON_RULE');
        const r = await this.dryRun(batchId);
        if (reportHash !== b.reportHash || r.reportHash !== b.reportHash)
            throw err(common_1.ConflictException, 'REPORT_CHANGED');
        await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'APPROVED', approvedBy: u.sub, approvedAt: new Date() } });
        await this.audit(u.sub, 'commit_approved', batchId, { reportHash });
        return { ok: true };
    }
    async reject(u, batchId, reason) {
        const b = await this.batch(batchId);
        if (!['AWAITING_APPROVAL', 'APPROVED'].includes(b.status))
            throw err(common_1.ConflictException, 'NOT_AWAITING_APPROVAL');
        if (!reason || reason.trim().length < 3)
            throw err(common_1.BadRequestException, 'REASON_REQUIRED');
        await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'READY', requestedBy: null, requestedAt: null, reportHash: null, approvedBy: null, approvedAt: null } });
        await this.audit(u.sub, 'commit_rejected', batchId, { reason });
        return { ok: true };
    }
    async commit(u, batchId) {
        const b = await this.batch(batchId);
        if (!['APPROVED', 'COMMIT_FAILED'].includes(b.status))
            throw err(common_1.ConflictException, 'NOT_APPROVED', { status: b.status });
        if (!b.approvedBy || !b.reportHash)
            throw err(common_1.ForbiddenException, 'APPROVAL_REQUIRED');
        const lock = await this.prisma.importBatch.updateMany({ where: { id: batchId, status: b.status }, data: { status: 'COMMITTING' } });
        if (lock.count !== 1)
            throw err(common_1.ConflictException, 'COMMIT_IN_PROGRESS');
        await this.audit(u.sub, b.status === 'COMMIT_FAILED' ? 'commit_resumed' : 'commit_started', batchId);
        const a = await this.run(batchId);
        if (this.reportHash(a) !== b.reportHash) {
            await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'READY', approvedBy: null, approvedAt: null, requestedBy: null, reportHash: null } });
            throw err(common_1.ConflictException, 'REPORT_CHANGED');
        }
        const doneItems = await this.prisma.importCommitItem.findMany({ where: { batchId, status: 'COMMITTED' } });
        const done = new Set(doneItems.map((i) => i.idempotencyKey));
        const targetIds = new Map(doneItems.filter((i) => i.entity === 'patients').map((i) => [i.sourceKey, i.targetId]));
        const progress = {};
        try {
            for (const entity of ['patients', 'appointments', 'visits', 'billing', 'documents']) {
                const todo = a.records[entity].filter((r) => !done.has(`imp:${batchId}:${entity}:${r.sourceKey}`));
                for (let i = 0; i < todo.length; i += COMMIT_CHUNK[entity]) {
                    const chunk = todo.slice(i, i + COMMIT_CHUNK[entity]);
                    const items = await Promise.all(chunk.map(async (r) => {
                        const data = { ...r.data };
                        delete data.__skipped;
                        if (entity !== 'patients' && r.data.patientRef)
                            data.patientTargetId = targetIds.get(String(r.data.patientRef));
                        let file;
                        if (entity === 'documents') {
                            const f = await this.prisma.importFile.findUnique({ where: { id: String(r.data.fileId) } });
                            file = { name: f.name, contentBase64: (await this.store.get(f.storageKey)).toString('base64') };
                            delete data.fileId;
                        }
                        return { idempotencyKey: `imp:${batchId}:${entity}:${r.sourceKey}`, sourceKey: r.sourceKey, data, file };
                    }));
                    const res = await this.target.commit({ batchId, orgId: b.orgId, orgName: b.orgName, entity, items });
                    await this.prisma.importCommitItem.createMany({ data: res.map((x) => ({ batchId, entity, sourceKey: x.sourceKey, targetId: x.targetId, idempotencyKey: `imp:${batchId}:${entity}:${x.sourceKey}` })), skipDuplicates: true });
                    if (entity === 'patients')
                        for (const x of res)
                            targetIds.set(x.sourceKey, x.targetId);
                    progress[entity] = (progress[entity] ?? 0) + res.length;
                    await this.prisma.importBatch.update({ where: { id: batchId }, data: { progress: { ...(await this.counts(batchId)), lastError: null } } });
                }
            }
        }
        catch (e) {
            const code = e?.code ?? e.message?.slice(0, 60) ?? 'COMMIT_ERROR';
            this.log.error(`commit failed batch=${batchId} code=${String(code).slice(0, 60)}`);
            await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMIT_FAILED', progress: { ...(await this.counts(batchId)), lastError: String(code).slice(0, 80) } } });
            await this.audit(u.sub, 'commit_failed', batchId, { code: String(code).slice(0, 80) });
            throw err(common_1.ConflictException, 'COMMIT_FAILED_RESUMABLE', { progress: await this.counts(batchId) });
        }
        await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMITTED', committedAt: new Date(), progress: { ...(await this.counts(batchId)), lastError: null } } });
        await this.audit(u.sub, 'commit_completed', batchId, await this.counts(batchId));
        this.log.log(`commit completed batch=${batchId}`);
        return { ok: true, committed: await this.counts(batchId) };
    }
    async counts(batchId) { const g = await this.prisma.importCommitItem.groupBy({ by: ['entity'], where: { batchId, status: 'COMMITTED' }, _count: true }); return Object.fromEntries(g.map((x) => [x.entity, x._count])); }
    async rollback(u, batchId, reason) {
        const b = await this.batch(batchId);
        if (!['COMMITTED', 'COMMIT_FAILED', 'ROLLING_BACK'].includes(b.status))
            throw err(common_1.ConflictException, 'NOT_ROLLBACKABLE', { status: b.status });
        if (!reason || reason.trim().length < 3)
            throw err(common_1.BadRequestException, 'REASON_REQUIRED');
        await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'ROLLING_BACK' } });
        await this.audit(u.sub, 'rollback_started', batchId, { reason });
        try {
            const r = await this.target.rollback({ batchId, orgId: b.orgId });
            await this.prisma.importCommitItem.updateMany({ where: { batchId }, data: { status: 'ROLLED_BACK' } });
            await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } });
            await this.audit(u.sub, 'rollback_completed', batchId, { removed: r.removed });
            return { ok: true, removed: r.removed };
        }
        catch (e) {
            await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMIT_FAILED' } });
            await this.audit(u.sub, 'rollback_failed', batchId);
            throw err(common_1.ConflictException, 'ROLLBACK_FAILED_RETRY');
        }
    }
    async purgeStaging(u, batchId) {
        const b = await this.batch(batchId);
        if (!['COMMITTED', 'ROLLED_BACK'].includes(b.status))
            throw err(common_1.ConflictException, 'NOT_PURGEABLE', { status: b.status });
        await this.store.deleteBatch(batchId);
        await this.prisma.importFile.updateMany({ where: { batchId }, data: { tables: null, storageKey: null } });
        await this.audit(u.sub, 'staging_purged', batchId);
        return { ok: true };
    }
    async auditTrail(batchId) { await this.batch(batchId); return this.prisma.auditLog.findMany({ where: { resource: 'ImportBatch', resourceId: batchId }, orderBy: { createdAt: 'asc' } }); }
};
exports.OnboardingImportService = OnboardingImportService;
exports.OnboardingImportService = OnboardingImportService = __decorate([
    (0, common_1.Injectable)(),
    __param(1, (0, common_1.Inject)(adapters_1.STAGING_STORE)),
    __param(2, (0, common_1.Inject)(file_scan_1.MALWARE_SCANNER)),
    __param(3, (0, common_1.Inject)(adapters_1.IMPORT_TARGET)),
    __metadata("design:paramtypes", [prisma_service_1.PrismaService, Object, Object, Object])
], OnboardingImportService);
//# sourceMappingURL=onboarding-import.service.js.map