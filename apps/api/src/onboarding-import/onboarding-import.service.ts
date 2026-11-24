import { BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash, randomUUID } from 'node:crypto';
import { PrismaService } from '../prisma/prisma.service';
import type { AuthUser } from '../common/auth';
import { IMPORT_TARGET, STAGING_STORE, type ImportTarget, type StagingStore } from './adapters';
import { analyze, type AnalysisResult, type Decision, type StagedFile, type SourceTable, type Task, type TaskAction } from './lib/analyzer';
import { parseCsv, type ParsedTable } from './lib/csv';
import { decodeText } from './lib/encoding';
import { MALWARE_SCANNER, scanUpload, type MalwareScanner } from './lib/file-scan';
import { ENTITIES, type Entity } from './lib/mapper';
import { parseSqlDump } from './lib/sql-parser';
import { parseXlsx } from './lib/xlsx';

/** Business errors carry stable codes (the console shows localized text by code). Never put row values in a message. */
const err = (E: new (b: object) => Error, code: string, extra: object = {}) => new E({ code, message: code, ...extra });
const MAX_FILES_PER_BATCH = 500;
const COMMIT_CHUNK: Record<Entity, number> = { patients: 100, appointments: 200, visits: 200, billing: 200, documents: 2 };

@Injectable()
export class OnboardingImportService {
  private readonly log = new Logger('onboarding-import'); // ids, counts, codes only: never names, phones, file names or values
  constructor(private readonly prisma: PrismaService, @Inject(STAGING_STORE) private readonly store: StagingStore, @Inject(MALWARE_SCANNER) private readonly scanner: MalwareScanner, @Inject(IMPORT_TARGET) private readonly target: ImportTarget) {}

  private audit(actor: string, action: string, batchId: string, metadata?: object) { return this.prisma.auditLog.create({ data: { actor, action: `onboarding.${action}`, resource: 'ImportBatch', resourceId: batchId, metadata: metadata as any } }); }
  private async batch(id: string) { const b = await this.prisma.importBatch.findUnique({ where: { id } }); if (!b) throw err(NotFoundException, 'IMPORT_NOT_FOUND'); return b; }
  private assertEditable(status: string) { if (!['DRAFT', 'NEEDS_REVIEW', 'READY', 'AWAITING_APPROVAL', 'APPROVED'].includes(status)) throw err(ConflictException, 'IMPORT_LOCKED', { status }); }

  async create(u: AuthUser, b: { orgId: string; orgName: string; label?: string }) {
    const row = await this.prisma.importBatch.create({ data: { orgId: b.orgId, orgName: b.orgName, label: b.label, createdBy: u.sub } });
    await this.audit(u.sub, 'batch_created', row.id, { orgId: b.orgId });
    return this.view(row);
  }

  view(b: any) { const { summary, progress, ...rest } = b; return { ...rest, summary: summary ?? null, progress: progress ?? null }; }
  async list() { return (await this.prisma.importBatch.findMany({ orderBy: { createdAt: 'desc' }, take: 100 })).map((b) => this.view(b)); }
  async get(id: string) { const b = await this.batch(id); const files = await this.prisma.importFile.findMany({ where: { batchId: id }, select: { id: true, name: true, kind: true, rejectReason: true, size: true, sha256: true, meta: true, createdAt: true }, orderBy: { createdAt: 'asc' } }); return { ...this.view(b), files }; }

  // ───────── upload → quarantine → scan → parse ─────────
  async addFile(u: AuthUser, batchId: string, name: string, contentBase64: string) {
    const b = await this.batch(batchId); this.assertEditable(b.status);
    if ((await this.prisma.importFile.count({ where: { batchId } })) >= MAX_FILES_PER_BATCH) throw err(BadRequestException, 'IMPORT_TOO_MANY_FILES');
    const safeName = name.replace(/[\\/\0]/g, '_').slice(0, 200);
    // Node's base64 decoder silently skips illegal characters, so a damaged or truncated upload would be stored as a DIFFERENT file with a valid-looking hash. Strict RFC 4648 only.
    const compact = contentBase64.replace(/\s+/g, '');
    if (!/^[A-Za-z0-9+/]*={0,2}$/.test(compact) || compact.length % 4 === 1) throw err(BadRequestException, 'IMPORT_BAD_BASE64');
    const bytes = Buffer.from(compact, 'base64');
    const v = await scanUpload(safeName, bytes, this.scanner);
    const fileId = randomUUID();
    if (!v.ok) {
      const row = await this.prisma.importFile.create({ data: { id: fileId, batchId, name: safeName, kind: 'REJECTED', rejectReason: v.reason, sha256: v.sha256, size: bytes.length, sniffed: v.sniffed } });
      this.log.warn(`file rejected batch=${batchId} file=${fileId} reason=${v.reason} size=${bytes.length}`);
      await this.audit(u.sub, 'file_rejected', batchId, { fileId, reason: v.reason });
      await this.reanalyze(batchId);
      return { id: row.id, kind: 'REJECTED', rejectReason: v.reason };
    }
    const storageKey = await this.store.put(batchId, fileId, bytes);
    let tables: ParsedTable[] | null = null; let meta: Record<string, unknown> | null = null;
    try {
      if (v.cls === 'SQL') { const d = decodeText(bytes); const r = parseSqlDump(d.text); tables = r.tables; meta = { dialect: r.dialect, statements: r.statements, skipped: r.skipped, dangerous: r.dangerous, encoding: d.encoding, encodingIssues: d.issues }; }
      else if (v.cls === 'CSV') { const d = decodeText(bytes); tables = [parseCsv(d.text, safeName.replace(/\.[^.]+$/, ''))]; meta = { encoding: d.encoding, encodingIssues: d.issues }; }
      else if (v.cls === 'XLSX') tables = parseXlsx(bytes, safeName.replace(/\.[^.]+$/, ''));
    } catch (e) {
      await this.prisma.importFile.create({ data: { id: fileId, batchId, name: safeName, kind: 'REJECTED', rejectReason: 'UNPARSEABLE', sha256: v.sha256, size: bytes.length, sniffed: v.sniffed, storageKey } });
      this.log.warn(`parse failed batch=${batchId} file=${fileId} err=${(e as Error).name}`);
      await this.reanalyze(batchId); return { id: fileId, kind: 'REJECTED', rejectReason: 'UNPARSEABLE' };
    }
    await this.prisma.importFile.create({ data: { id: fileId, batchId, name: safeName, kind: v.cls, sha256: v.sha256, size: bytes.length, sniffed: v.sniffed, storageKey, tables: tables as any, meta: meta as any } });
    this.log.log(`file staged batch=${batchId} file=${fileId} kind=${v.cls} size=${bytes.length}`);
    await this.audit(u.sub, 'file_staged', batchId, { fileId, kind: v.cls, size: bytes.length });
    await this.reanalyze(batchId);
    return { id: fileId, kind: v.cls };
  }

  // ───────── deterministic analysis ─────────
  private async run(batchId: string): Promise<AnalysisResult> {
    const files = await this.prisma.importFile.findMany({ where: { batchId }, orderBy: { createdAt: 'asc' } });
    const tables: SourceTable[] = []; const staged: StagedFile[] = []; const unsafe: string[] = [];
    for (const f of files) {
      if (f.tables) for (const t of f.tables as unknown as ParsedTable[]) tables.push({ fileId: f.id, table: t });
      if ((f.meta as any)?.dangerous?.length) unsafe.push(...(f.meta as any).dangerous);
      if (f.kind === 'PATIENT_FILE') staged.push({ fileId: f.id, name: f.name, sha256: f.sha256, size: f.size, kind: 'PATIENT_FILE' });
      else if (f.kind === 'REJECTED') staged.push({ fileId: f.id, name: f.name, sha256: f.sha256, size: f.size, kind: 'REJECTED', rejectReason: f.rejectReason ?? undefined });
    }
    const decisions = (await this.prisma.importDecision.findMany({ where: { batchId } })).map((d) => ({ taskKey: d.taskKey, action: d.action as TaskAction, params: (d.params as any) ?? undefined, reason: d.reason ?? undefined }) as Decision);
    return analyze({ tables, files: staged, decisions, unsafe: [...new Set(unsafe)] });
  }

  /** Re-run the pure analyzer and reconcile the task table. Tasks that disappear but had a decision stay as history (RESOLVED); others vanish. */
  async reanalyze(batchId: string) {
    const b = await this.batch(batchId); if (!['DRAFT', 'NEEDS_REVIEW', 'READY', 'AWAITING_APPROVAL', 'APPROVED'].includes(b.status)) return;
    const a = await this.run(batchId);
    const existing = new Map((await this.prisma.importTask.findMany({ where: { batchId } })).map((t) => [t.key, t]));
    const decided = new Set((await this.prisma.importDecision.findMany({ where: { batchId }, select: { taskKey: true } })).map((d) => d.taskKey));
    const seen = new Set<string>();
    await this.prisma.$transaction(async (tx) => {
      for (const t of a.tasks) {
        seen.add(t.key); const data = { type: t.type, severity: t.severity, entity: t.entity ?? null, status: t.status, payload: t as any };
        await tx.importTask.upsert({ where: { batchId_key: { batchId, key: t.key } }, create: { batchId, key: t.key, ...data }, update: data });
      }
      for (const [key, row] of existing) if (!seen.has(key)) {
        if (decided.has(key) || ['RESOLVED', 'IGNORED'].includes(row.status)) await tx.importTask.update({ where: { id: row.id }, data: { status: row.status === 'OPEN' ? 'RESOLVED' : row.status, payload: { ...(row.payload as any), status: row.status === 'OPEN' ? 'RESOLVED' : row.status } } });
        else await tx.importTask.delete({ where: { id: row.id } });
      }
    });
    const status = a.stats.blockers ? 'NEEDS_REVIEW' : (a.stats.rows.patients || a.stats.filesTotal) ? 'READY' : 'DRAFT';
    // any change after the request/approval invalidates it: the approved report hash no longer matches
    const hash = this.reportHash(a); const keep = b.reportHash === hash && ['AWAITING_APPROVAL', 'APPROVED'].includes(b.status) && !a.stats.blockers;
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: keep ? b.status : status, ...(keep ? {} : { requestedBy: null, requestedAt: null, reportHash: null, approvedBy: null, approvedAt: null }), summary: { classification: a.classification, mappings: a.mappings, stats: a.stats } as any } });
    return a;
  }

  // ───────── resolution queue ─────────
  async tasks(batchId: string, q: { status?: string; severity?: string; type?: string; page?: number; pageSize?: number }) {
    await this.batch(batchId); const pageSize = Math.min(q.pageSize ?? 50, 200); const page = Math.max(q.page ?? 1, 1);
    const where: any = { batchId, ...(q.status ? { status: q.status } : {}), ...(q.severity ? { severity: q.severity } : {}), ...(q.type ? { type: q.type } : {}) };
    const [total, rows] = await Promise.all([this.prisma.importTask.count({ where }), this.prisma.importTask.findMany({ where, orderBy: [{ severity: 'asc' }, { createdAt: 'asc' }], skip: (page - 1) * pageSize, take: pageSize })]);
    const counts = await this.prisma.importTask.groupBy({ by: ['status', 'severity'], where: { batchId }, _count: true });
    return { total, page, pageSize, counts: counts.map((c) => ({ status: c.status, severity: c.severity, count: c._count })), items: rows.map((r) => ({ id: r.id, ...(r.payload as object), status: r.status, resolvedBy: r.resolvedBy })) };
  }

  async resolve(u: AuthUser, batchId: string, taskId: string, body: { action: TaskAction; params?: Record<string, any>; reason?: string }) {
    const b = await this.batch(batchId); this.assertEditable(b.status);
    const row = await this.prisma.importTask.findFirst({ where: { id: taskId, batchId } }); if (!row) throw err(NotFoundException, 'TASK_NOT_FOUND');
    const t = row.payload as unknown as Task;
    if (!t.actions.includes(body.action)) throw err(BadRequestException, 'ACTION_NOT_ALLOWED', { allowed: t.actions });
    if (body.action === 'IGNORE' && !(body.reason && body.reason.trim().length >= 3)) throw err(BadRequestException, 'IGNORE_REASON_REQUIRED');
    this.validateParams(t, body);
    // SKIP_ROW is recorded against the ROW (so every task of that row disappears), everything else against the task key
    const key = body.action === 'SKIP_ROW' && t.type !== 'DUPLICATE_PATIENT' && t.entity && t.ref?.sourceKey ? `skip:${t.entity}:${t.ref.sourceKey}` : body.action === 'CHOOSE_DATE_FORMAT' ? 'fmt:dayFirst' : body.action === 'MAP_COLUMN' && t.entity ? `map:${t.entity}:${t.ref?.field}` : body.action === 'MAP_TABLE' ? `table:${t.ref?.table}` : body.action === 'ACCEPT_REPAIR' ? t.key : t.key;
    const params = body.action === 'CHOOSE_DATE_FORMAT' ? { dayFirst: body.params?.dayFirst !== false } : body.params;
    await this.prisma.importDecision.upsert({ where: { batchId_taskKey: { batchId, taskKey: key } }, create: { batchId, taskKey: key, action: body.action, params: params as any, reason: body.reason, decidedBy: u.sub }, update: { action: body.action, params: params as any, reason: body.reason, decidedBy: u.sub } });
    if (key !== t.key && body.action !== 'MAP_COLUMN' && body.action !== 'MAP_TABLE' && body.action !== 'CHOOSE_DATE_FORMAT') await this.prisma.importDecision.upsert({ where: { batchId_taskKey: { batchId, taskKey: t.key } }, create: { batchId, taskKey: t.key, action: body.action, params: params as any, reason: body.reason, decidedBy: u.sub }, update: { action: body.action, params: params as any, reason: body.reason, decidedBy: u.sub } });
    await this.prisma.importTask.update({ where: { id: row.id }, data: { resolvedBy: u.sub } });
    await this.audit(u.sub, 'task_resolved', batchId, { taskType: t.type, action: body.action, severity: t.severity }); // no values
    await this.reanalyze(batchId);
    return this.tasks(batchId, { status: 'OPEN', pageSize: 1 }).then((r) => ({ ok: true, open: r.total }));
  }

  async resolveMany(u: AuthUser, batchId: string, ids: string[], body: { action: TaskAction; params?: Record<string, any>; reason?: string }) {
    if (ids.length > 500) throw err(BadRequestException, 'TOO_MANY_TASKS');
    let n = 0; for (const id of ids) { try { await this.resolve(u, batchId, id, body); n++; } catch (e) { if ((e as any)?.getStatus?.() !== 404) throw e; } } // a task can vanish once an earlier one in the batch fixed it
    return { ok: true, resolved: n };
  }

  private validateParams(t: Task, b: { action: TaskAction; params?: Record<string, any> }) {
    const p = b.params ?? {};
    if (b.action === 'EDIT_VALUE' && (typeof p.value !== 'string' || p.value.length > 500)) throw err(BadRequestException, 'VALUE_REQUIRED');
    if (b.action === 'MAP_COLUMN' && !(typeof p.column === 'string' && (t.context.columns as string[] | undefined ? (t.context.columns as string[]).includes(p.column) : true))) throw err(BadRequestException, 'COLUMN_REQUIRED');
    if (b.action === 'MAP_TABLE' && p.entity !== null && !ENTITIES.includes(p.entity)) throw err(BadRequestException, 'ENTITY_REQUIRED');
    if (b.action === 'ASSIGN_FILE' || b.action === 'ASSIGN_PATIENT') { if (typeof p.sourceKey !== 'string') throw err(BadRequestException, 'PATIENT_REQUIRED'); }
    if (b.action === 'MERGE' && p.keep !== undefined && typeof p.keep !== 'string') throw err(BadRequestException, 'KEEP_REQUIRED');
  }

  /** Searchable patient list for the "assign to patient" picker (masked-free: ops are authorised, but capped). */
  async patientsLookup(batchId: string, q: string) {
    const a = await this.run(batchId); const s = q.trim().toLowerCase();
    return a.records.patients.filter((p) => !s || p.sourceKey.toLowerCase().includes(s) || String(p.data.fullName ?? '').toLowerCase().includes(s) || String(p.data.phone ?? '').includes(s)).slice(0, 20).map((p) => ({ sourceKey: p.sourceKey, name: p.data.fullName, phone: p.data.phone }));
  }

  // ───────── dry-run ─────────
  private reportHash(a: AnalysisResult) {
    const canon = JSON.stringify({ r: ENTITIES.map((e) => [e, a.records[e].map((x) => [x.sourceKey, x.data])]), l: a.fileLinks.map((l) => [l.fileId, l.patientSourceKey]) });
    return createHash('sha256').update(canon).digest('hex');
  }
  async dryRun(batchId: string) {
    const b = await this.batch(batchId); const a = ['COMMITTED', 'ROLLED_BACK', 'COMMITTING', 'COMMIT_FAILED', 'ROLLING_BACK'].includes(b.status) ? null : await this.run(batchId);
    if (!a) return { batchId, status: b.status, progress: b.progress };
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

  // ───────── two-person rule ─────────
  async requestCommit(u: AuthUser, batchId: string) {
    const b = await this.batch(batchId); if (!['READY', 'AWAITING_APPROVAL'].includes(b.status)) throw err(ConflictException, 'IMPORT_NOT_READY', { status: b.status });
    const r = await this.dryRun(batchId) as any; if (!r.canCommit) throw err(ConflictException, 'BLOCKERS_OPEN', { blockers: r.openBlockers });
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'AWAITING_APPROVAL', requestedBy: u.sub, requestedAt: new Date(), reportHash: r.reportHash, approvedBy: null, approvedAt: null } });
    await this.audit(u.sub, 'commit_requested', batchId, { reportHash: r.reportHash, willCreate: r.willCreate });
    return { ok: true, reportHash: r.reportHash };
  }
  async approve(u: AuthUser, batchId: string, reportHash: string) {
    const b = await this.batch(batchId); if (b.status !== 'AWAITING_APPROVAL') throw err(ConflictException, 'NOT_AWAITING_APPROVAL', { status: b.status });
    if (u.sub === b.requestedBy || u.sub === b.createdBy) throw err(ForbiddenException, 'TWO_PERSON_RULE');
    const r = await this.dryRun(batchId) as any;
    if (reportHash !== b.reportHash || r.reportHash !== b.reportHash) throw err(ConflictException, 'REPORT_CHANGED');
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'APPROVED', approvedBy: u.sub, approvedAt: new Date() } });
    await this.audit(u.sub, 'commit_approved', batchId, { reportHash });
    return { ok: true };
  }
  async reject(u: AuthUser, batchId: string, reason: string) {
    const b = await this.batch(batchId); if (!['AWAITING_APPROVAL', 'APPROVED'].includes(b.status)) throw err(ConflictException, 'NOT_AWAITING_APPROVAL');
    if (!reason || reason.trim().length < 3) throw err(BadRequestException, 'REASON_REQUIRED');
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'READY', requestedBy: null, requestedAt: null, reportHash: null, approvedBy: null, approvedAt: null } });
    await this.audit(u.sub, 'commit_rejected', batchId, { reason });
    return { ok: true };
  }

  // ───────── commit (idempotent, resumable) ─────────
  async commit(u: AuthUser, batchId: string) {
    const b = await this.batch(batchId);
    if (!['APPROVED', 'COMMIT_FAILED'].includes(b.status)) throw err(ConflictException, 'NOT_APPROVED', { status: b.status });
    if (!b.approvedBy || !b.reportHash) throw err(ForbiddenException, 'APPROVAL_REQUIRED');
    const lock = await this.prisma.importBatch.updateMany({ where: { id: batchId, status: b.status }, data: { status: 'COMMITTING' } });
    if (lock.count !== 1) throw err(ConflictException, 'COMMIT_IN_PROGRESS');
    await this.audit(u.sub, b.status === 'COMMIT_FAILED' ? 'commit_resumed' : 'commit_started', batchId);
    const a = await this.run(batchId);
    if (this.reportHash(a) !== b.reportHash) { await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'READY', approvedBy: null, approvedAt: null, requestedBy: null, reportHash: null } }); throw err(ConflictException, 'REPORT_CHANGED'); }
    const doneItems = await this.prisma.importCommitItem.findMany({ where: { batchId, status: 'COMMITTED' } });
    const done = new Set(doneItems.map((i) => i.idempotencyKey)); const targetIds = new Map(doneItems.filter((i) => i.entity === 'patients').map((i) => [i.sourceKey, i.targetId]));
    const progress: Record<string, number> = {};
    try {
      for (const entity of ['patients', 'appointments', 'visits', 'billing', 'documents'] as Entity[]) {
        const todo = a.records[entity].filter((r) => !done.has(`imp:${batchId}:${entity}:${r.sourceKey}`));
        for (let i = 0; i < todo.length; i += COMMIT_CHUNK[entity]) {
          const chunk = todo.slice(i, i + COMMIT_CHUNK[entity]);
          const items = await Promise.all(chunk.map(async (r) => {
            const data: Record<string, unknown> = { ...r.data }; delete data.__skipped;
            if (entity !== 'patients' && r.data.patientRef) data.patientTargetId = targetIds.get(String(r.data.patientRef));
            let file: { name: string; contentBase64: string } | undefined;
            if (entity === 'documents') { const f = await this.prisma.importFile.findUnique({ where: { id: String(r.data.fileId) } }); file = { name: f!.name, contentBase64: (await this.store.get(f!.storageKey!)).toString('base64') }; delete data.fileId; }
            return { idempotencyKey: `imp:${batchId}:${entity}:${r.sourceKey}`, sourceKey: r.sourceKey, data, file };
          }));
          const res = await this.target.commit({ batchId, orgId: b.orgId, orgName: b.orgName, entity, items });
          await this.prisma.importCommitItem.createMany({ data: res.map((x) => ({ batchId, entity, sourceKey: x.sourceKey, targetId: x.targetId, idempotencyKey: `imp:${batchId}:${entity}:${x.sourceKey}` })), skipDuplicates: true });
          if (entity === 'patients') for (const x of res) targetIds.set(x.sourceKey, x.targetId);
          progress[entity] = (progress[entity] ?? 0) + res.length;
          await this.prisma.importBatch.update({ where: { id: batchId }, data: { progress: { ...(await this.counts(batchId)), lastError: null } as any } });
        }
      }
    } catch (e) {
      const code = (e as any)?.code ?? (e as Error).message?.slice(0, 60) ?? 'COMMIT_ERROR';
      this.log.error(`commit failed batch=${batchId} code=${String(code).slice(0, 60)}`);
      await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMIT_FAILED', progress: { ...(await this.counts(batchId)), lastError: String(code).slice(0, 80) } as any } });
      await this.audit(u.sub, 'commit_failed', batchId, { code: String(code).slice(0, 80) });
      throw err(ConflictException, 'COMMIT_FAILED_RESUMABLE', { progress: await this.counts(batchId) });
    }
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMITTED', committedAt: new Date(), progress: { ...(await this.counts(batchId)), lastError: null } as any } });
    await this.audit(u.sub, 'commit_completed', batchId, await this.counts(batchId));
    this.log.log(`commit completed batch=${batchId}`);
    return { ok: true, committed: await this.counts(batchId) };
  }
  private async counts(batchId: string) { const g = await this.prisma.importCommitItem.groupBy({ by: ['entity'], where: { batchId, status: 'COMMITTED' }, _count: true }); return Object.fromEntries(g.map((x) => [x.entity, x._count])); }

  async rollback(u: AuthUser, batchId: string, reason: string) {
    const b = await this.batch(batchId); if (!['COMMITTED', 'COMMIT_FAILED', 'ROLLING_BACK'].includes(b.status)) throw err(ConflictException, 'NOT_ROLLBACKABLE', { status: b.status });
    if (!reason || reason.trim().length < 3) throw err(BadRequestException, 'REASON_REQUIRED');
    await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'ROLLING_BACK' } });
    await this.audit(u.sub, 'rollback_started', batchId, { reason });
    try { const r = await this.target.rollback({ batchId, orgId: b.orgId }); await this.prisma.importCommitItem.updateMany({ where: { batchId }, data: { status: 'ROLLED_BACK' } }); await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'ROLLED_BACK', rolledBackAt: new Date() } }); await this.audit(u.sub, 'rollback_completed', batchId, { removed: r.removed }); return { ok: true, removed: r.removed }; }
    catch (e) { await this.prisma.importBatch.update({ where: { id: batchId }, data: { status: 'COMMIT_FAILED' } }); await this.audit(u.sub, 'rollback_failed', batchId); throw err(ConflictException, 'ROLLBACK_FAILED_RETRY'); }
  }

  /** Purge staging PHI after commit/rollback/cancel (blobs + parsed rows); decisions, tasks (masked context) and audit stay. */
  async purgeStaging(u: AuthUser, batchId: string) {
    const b = await this.batch(batchId); if (!['COMMITTED', 'ROLLED_BACK'].includes(b.status)) throw err(ConflictException, 'NOT_PURGEABLE', { status: b.status });
    await this.store.deleteBatch(batchId); await this.prisma.importFile.updateMany({ where: { batchId }, data: { tables: null as any, storageKey: null } });
    await this.audit(u.sub, 'staging_purged', batchId); return { ok: true };
  }

  async auditTrail(batchId: string) { await this.batch(batchId); return this.prisma.auditLog.findMany({ where: { resource: 'ImportBatch', resourceId: batchId }, orderBy: { createdAt: 'asc' } }); }
}
