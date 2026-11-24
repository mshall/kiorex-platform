"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.analyze = analyze;
const mapper_1 = require("./mapper");
const encoding_1 = require("./encoding");
const normalize_1 = require("./normalize");
function analyze(inp) {
    const dec = new Map(inp.decisions.map((d) => [d.taskKey, d]));
    const tasks = [];
    const now = inp.now ?? new Date();
    const add = (t) => {
        const d = dec.get(t.key);
        const task = { ...t, status: 'OPEN' };
        if (d) {
            const closes = d.action === 'IGNORE' ? 'IGNORED' : t.key.startsWith('val:') ? 'OPEN' : 'RESOLVED';
            task.status = closes;
            if (closes !== 'OPEN')
                task.resolution = { action: d.action, params: d.params, reason: d.reason };
        }
        tasks.push(task);
        return task;
    };
    const records = Object.fromEntries(mapper_1.ENTITIES.map((e) => [e, []]));
    const mappings = {};
    const classification = [];
    if (inp.unsafe?.length)
        add({ key: 'sql:unsafe', type: 'SQL_UNSAFE_STATEMENTS', severity: 'INFO', context: { statements: inp.unsafe, note: 'Never executed; data statements were parsed statically.' }, actions: ['IGNORE'] });
    const chosen = new Map();
    for (const st of inp.tables) {
        const c = (0, mapper_1.classifyTable)(st.table);
        const key = `table:${st.table.name}`;
        const d = dec.get(key);
        let entity = c.entity;
        if (d?.action === 'MAP_TABLE')
            entity = d.params?.entity && mapper_1.ENTITIES.includes(d.params.entity) ? d.params.entity : null;
        classification.push({ table: st.table.name, entity, score: Math.round(c.score * 100) / 100, rows: st.table.rows.length, fileId: st.fileId });
        if (st.table.truncated)
            add({ key: `trunc:${st.table.name}`, type: 'TRUNCATED_TABLE', severity: 'WARNING', context: { table: st.table.name, rowsKept: st.table.rows.length }, actions: ['IGNORE'] });
        if (!entity) {
            if (st.table.rows.length && !(d?.action === 'MAP_TABLE'))
                add({ key, type: 'TABLE_UNCLASSIFIED', severity: 'WARNING', ref: { table: st.table.name }, context: { table: st.table.name, columns: st.table.columns, rows: st.table.rows.length }, suggestion: { ranked: c.ranked.slice(0, 3) }, actions: ['MAP_TABLE', 'IGNORE'] });
            else if (d)
                add({ key, type: 'TABLE_UNCLASSIFIED', severity: 'WARNING', ref: { table: st.table.name }, context: { table: st.table.name }, actions: ['MAP_TABLE', 'IGNORE'] });
            continue;
        }
        const cur = chosen.get(entity);
        const forced = d?.action === 'MAP_TABLE';
        if (!cur || (forced ? true : c.score > cur.score))
            chosen.set(entity, { ...st, score: c.score });
        if (d?.action === 'MAP_TABLE')
            add({ key, type: 'TABLE_UNCLASSIFIED', severity: 'WARNING', ref: { table: st.table.name }, context: { table: st.table.name }, actions: ['MAP_TABLE', 'IGNORE'] });
    }
    const nameOk = (m) => m.some((x) => x.field === 'fullName' && x.column) || m.some((x) => x.field === 'firstName' && x.column);
    const encoding = new Map();
    for (const entity of mapper_1.ENTITIES) {
        const src = chosen.get(entity);
        if (!src)
            continue;
        const t = src.table;
        const prop = (0, mapper_1.proposeMapping)(entity, t);
        const m = prop.map((p) => { const d = dec.get(`map:${entity}:${p.field}`); return d?.action === 'MAP_COLUMN' ? { ...p, column: d.params?.column ?? null, confidence: d.params?.column ? 1 : 0 } : p; });
        mappings[entity] = m;
        for (const p of m) {
            const def = mapper_1.TARGET[entity].fields.find((f) => f.key === p.field);
            const key = `map:${entity}:${p.field}`;
            const isNameField = entity === 'patients' && (p.field === 'fullName' || p.field === 'firstName');
            const required = def.required || (entity === 'patients' && p.field === 'fullName' && !nameOk(m));
            if (!p.column && (required || (isNameField && !nameOk(m) && p.field === 'fullName')) && !(entity === 'patients' && p.field === 'fullName' && nameOk(m)))
                add({ key, type: 'MAP_COLUMN_REQUIRED', severity: 'BLOCKER', entity, ref: { field: p.field, table: t.name }, context: { field: p.field, table: t.name, columns: t.columns }, suggestion: { candidates: p.candidates }, actions: ['MAP_COLUMN'] });
            else if (p.column && p.confidence < mapper_1.AUTO_ACCEPT && !dec.get(key)?.params?.column)
                add({ key, type: 'CONFIRM_MAPPING', severity: 'WARNING', entity, ref: { field: p.field, table: t.name }, context: { field: p.field, table: t.name, proposed: p.column, confidence: p.confidence }, suggestion: { candidates: p.candidates }, actions: ['MAP_COLUMN', 'IGNORE'] });
        }
        const col = (f) => m.find((x) => x.field === f)?.column ?? null;
        const mapped = new Map(m.filter((x) => x.column).map((x) => [x.field, x.column]));
        t.rows.forEach((row, ix) => {
            const sk = (col('sourceId') && row[col('sourceId')]?.toString().trim()) || `${t.name}#${ix + 1}`;
            const data = {};
            for (const [f, c] of mapped) {
                let v = row[c] ?? null;
                if (typeof v === 'string')
                    v = v.trim() || null;
                if (typeof v === 'string' && (0, encoding_1.hasMojibake)(v)) {
                    const k = `enc:${entity}:${c}`;
                    const e = encoding.get(k) ?? { entity, table: t.name, column: c, count: 0 };
                    e.count++;
                    encoding.set(k, e);
                    if (dec.get(k)?.action === 'ACCEPT_REPAIR')
                        v = (0, encoding_1.repairMojibake)(v) ?? v;
                }
                data[f] = v;
            }
            records[entity].push({ sourceKey: sk, data });
        });
    }
    for (const [k, e] of encoding)
        add({ key: k, type: 'ENCODING_PROBLEM', severity: 'WARNING', entity: e.entity, ref: { table: e.table, field: e.column }, context: { table: e.table, column: e.column, affectedRows: e.count }, suggestion: { repair: 'UTF8_DOUBLE_ENCODING' }, actions: ['ACCEPT_REPAIR', 'IGNORE'] });
    const skipRow = (entity, sk) => dec.get(`skip:${entity}:${sk}`)?.action === 'SKIP_ROW';
    const edit = (entity, sk, f) => { const d = dec.get(`val:${entity}:${sk}:${f}`); return d?.action === 'EDIT_VALUE' ? String(d.params?.value ?? '') : undefined; };
    const rowTask = (entity, sk, field, type, sev, ctx, sugg, actions = ['EDIT_VALUE', 'SKIP_ROW']) => {
        const key = `val:${entity}:${sk}:${field}`;
        add({ key, type, severity: sev, entity, ref: { sourceKey: sk, field }, context: { field, ...ctx }, suggestion: sugg, actions });
    };
    const resolved = (entity, sk, f) => !!dec.get(`val:${entity}:${sk}:${f}`);
    const pat = records.patients;
    const live = [];
    for (const r of pat) {
        const sk = r.sourceKey;
        if (skipRow('patients', sk)) {
            r.data.__skipped = true;
            continue;
        }
        const d = r.data;
        for (const f of ['fullName', 'phone', 'dob', 'gender', 'email', 'nationalId', 'firstName', 'lastName']) {
            const e = edit('patients', sk, f);
            if (e !== undefined)
                d[f] = e || null;
        }
        if (!d.fullName && d.firstName)
            d.fullName = [d.firstName, d.lastName].filter(Boolean).join(' ');
        if (!d.fullName)
            rowTask('patients', sk, 'fullName', 'MISSING_REQUIRED', 'BLOCKER', { rowRef: sk });
        else {
            const sp = (0, normalize_1.splitName)(d.fullName);
            d.firstName ??= sp.first;
            d.lastName ??= sp.last;
        }
        const ph = (0, normalize_1.normalizePhone)(d.phone);
        if (!d.phone)
            rowTask('patients', sk, 'phone', 'MISSING_REQUIRED', 'BLOCKER', { rowRef: sk, name: (0, normalize_1.maskName)(d.fullName) });
        else if (!ph.valid)
            rowTask('patients', sk, 'phone', 'INVALID_VALUE', 'BLOCKER', { rowRef: sk, name: (0, normalize_1.maskName)(d.fullName), value: d.phone, reason: ph.reason }, ph.value ? { value: ph.value } : undefined);
        else
            d.phone = ph.value;
        if (d.dob) {
            const dd = (0, normalize_1.parseDate)(d.dob, { dayFirst: dec.get('fmt:dayFirst')?.params?.dayFirst ?? true, now });
            if (!dd.valid)
                rowTask('patients', sk, 'dob', 'INVALID_VALUE', 'WARNING', { rowRef: sk, value: d.dob, reason: dd.reason }, undefined, ['EDIT_VALUE', 'IGNORE']);
            else {
                if (dd.ambiguous && !resolved('patients', sk, 'dob') && !dec.get('fmt:dayFirst'))
                    rowTask('patients', sk, 'dob', 'AMBIGUOUS_DATE', 'WARNING', { rowRef: sk, value: d.dob }, { options: [dd.value, dd.alt] }, ['EDIT_VALUE', 'CHOOSE_DATE_FORMAT', 'IGNORE']);
                d.dob = dd.value;
            }
        }
        const nid = (0, normalize_1.parseNationalId)(d.nationalId);
        if (d.nationalId && !nid.valid)
            rowTask('patients', sk, 'nationalId', 'INVALID_VALUE', 'WARNING', { rowRef: sk, value: d.nationalId }, undefined, ['EDIT_VALUE', 'IGNORE']);
        else if (nid.valid) {
            d.nationalId = nid.value;
            if (!d.dob)
                d.dob = nid.dob;
        }
        const g = (0, normalize_1.normalizeGender)(d.gender);
        d.gender = g ?? nid.gender ?? null;
        if (d.gender == null)
            rowTask('patients', sk, 'gender', 'INVALID_VALUE', 'WARNING', { rowRef: sk, value: r.data.gender }, { options: ['MALE', 'FEMALE'] }, ['EDIT_VALUE', 'IGNORE']);
        live.push(r);
    }
    const groups = new Map();
    const push = (k, r) => { const a = groups.get(k) ?? []; a.push(r); groups.set(k, a); };
    for (const r of live) {
        if (r.data.nationalId)
            push(`nid:${r.data.nationalId}`, r);
        push(`pn:${r.data.phone ?? ''}|${(0, normalize_1.nameKey)(r.data.fullName)}`, r);
    }
    const merged = new Map();
    const dupSeen = new Set();
    let mergedPatients = 0;
    for (const [gk, rs] of groups) {
        if (rs.length < 2 || gk.startsWith('pn:|'))
            continue;
        const ids = rs.map((r) => r.sourceKey).sort();
        const sig = ids.join(',');
        if (dupSeen.has(sig))
            continue;
        dupSeen.add(sig);
        const key = `dup:${sig}`;
        const t = add({ key, type: 'DUPLICATE_PATIENT', severity: 'BLOCKER', entity: 'patients', ref: { sourceKey: ids[0] }, context: { reason: gk.startsWith('nid:') ? 'SAME_NATIONAL_ID' : 'SAME_PHONE_AND_NAME', members: rs.map((r) => ({ sourceKey: r.sourceKey, name: (0, normalize_1.maskName)(r.data.fullName), phone: (0, normalize_1.maskPhone)(r.data.phone), dob: r.data.dob ?? null })) }, suggestion: { keep: ids[0] }, actions: ['MERGE', 'KEEP_BOTH', 'SKIP_ROW'] });
        const d = dec.get(key);
        if (d?.action === 'MERGE') {
            const keep = ids.includes(d.params?.keep) ? d.params.keep : ids[0];
            for (const id of ids)
                if (id !== keep) {
                    merged.set(id, keep);
                    mergedPatients++;
                }
        }
        else if (d?.action === 'SKIP_ROW')
            for (const id of ids.slice(1))
                merged.set(id, '__skip__');
        void t;
    }
    const patientKeys = new Set();
    const outPatients = [];
    for (const r of live) {
        if (merged.has(r.sourceKey))
            continue;
        outPatients.push(r);
        patientKeys.add(r.sourceKey);
    }
    records.patients = outPatients;
    const resolveRef = (ref) => { if (!ref)
        return null; const s = String(ref).trim(); const m = merged.get(s); return m && m !== '__skip__' ? m : patientKeys.has(s) ? s : null; };
    for (const entity of ['appointments', 'visits', 'billing', 'documents']) {
        const out = [];
        const dateField = entity === 'appointments' ? 'startsAt' : entity === 'visits' ? 'visitedAt' : entity === 'billing' ? 'issuedAt' : null;
        for (const r of records[entity]) {
            const sk = r.sourceKey;
            if (skipRow(entity, sk))
                continue;
            const d = r.data;
            const assign = dec.get(`val:${entity}:${sk}:patientRef`);
            const refIn = assign?.action === 'ASSIGN_PATIENT' ? String(assign.params?.sourceKey ?? '') : (edit(entity, sk, 'patientRef') ?? d.patientRef);
            if (entity !== 'documents' || refIn) {
                const pid = resolveRef(refIn);
                if (!pid) {
                    rowTask(entity, sk, 'patientRef', 'ORPHAN_REFERENCE', 'BLOCKER', { rowRef: sk, patientRef: refIn ?? null }, undefined, ['ASSIGN_PATIENT', 'SKIP_ROW']);
                    continue;
                }
                d.patientRef = pid;
            }
            if (dateField) {
                const e = edit(entity, sk, dateField);
                const raw = e ?? d[dateField];
                const dd = (0, normalize_1.parseDate)(raw, { dayFirst: dec.get('fmt:dayFirst')?.params?.dayFirst ?? true, allowFuture: entity === 'appointments', now });
                if (!dd.valid) {
                    rowTask(entity, sk, dateField, raw ? 'INVALID_VALUE' : 'MISSING_REQUIRED', 'BLOCKER', { rowRef: sk, value: raw ?? null, reason: dd.reason });
                    continue;
                }
                d[dateField] = dd.value;
                if (dd.ambiguous && !dec.get('fmt:dayFirst') && !resolved(entity, sk, dateField))
                    rowTask(entity, sk, dateField, 'AMBIGUOUS_DATE', 'WARNING', { rowRef: sk, value: raw }, { options: [dd.value, dd.alt] }, ['EDIT_VALUE', 'CHOOSE_DATE_FORMAT', 'IGNORE']);
            }
            if (entity === 'billing') {
                const raw = edit(entity, sk, 'amount') ?? d.amount;
                const n = Number((0, normalize_1.latinDigits)(String(raw ?? '')).replace(/,/g, ''));
                if (!raw || !Number.isFinite(n) || n < 0) {
                    rowTask(entity, sk, 'amount', raw ? 'INVALID_VALUE' : 'MISSING_REQUIRED', 'BLOCKER', { rowRef: sk, value: raw ?? null });
                    continue;
                }
                d.amountMinor = Math.round(n * 100);
                d.paidMinor = d.paid != null ? Math.round(Number((0, normalize_1.latinDigits)(String(d.paid)).replace(/,/g, '')) * 100) || 0 : 0;
                d.currency ??= 'EGP';
            }
            out.push(r);
        }
        records[entity] = out;
    }
    const usable = inp.files.filter((f) => f.kind === 'PATIENT_FILE');
    const seen = new Map();
    const fileLinks = [];
    const skippedFiles = [];
    for (const f of inp.files.filter((x) => x.kind === 'REJECTED'))
        add({ key: `file:${f.fileId}`, type: 'FILE_REJECTED', severity: 'WARNING', ref: { fileId: f.fileId }, context: { fileId: f.fileId, reason: f.rejectReason, size: f.size }, actions: ['IGNORE'] });
    const docByName = new Map();
    for (const r of records.documents) {
        const fn = String(r.data.fileName ?? '').split(/[\\/]/).pop()?.toLowerCase();
        if (fn)
            docByName.set(fn, r);
    }
    const byId = new Map(records.patients.map((p) => [p.sourceKey.toLowerCase(), p]));
    const byNid = new Map(records.patients.filter((p) => p.data.nationalId).map((p) => [p.data.nationalId, p]));
    const byPhone = new Map();
    for (const p of records.patients)
        if (p.data.phone) {
            const k = p.data.phone.slice(-10);
            byPhone.set(k, [...(byPhone.get(k) ?? []), p]);
        }
    for (const f of usable) {
        if (seen.has(f.sha256)) {
            skippedFiles.push(f.fileId);
            add({ key: `file:${f.fileId}`, type: 'DUPLICATE_FILE', severity: 'INFO', ref: { fileId: f.fileId }, context: { fileId: f.fileId, duplicateOf: seen.get(f.sha256) }, actions: ['IGNORE'] });
            continue;
        }
        seen.set(f.sha256, f.fileId);
        const key = `file:${f.fileId}`;
        const d = dec.get(key);
        if (d?.action === 'SKIP_FILE') {
            skippedFiles.push(f.fileId);
            add({ key, type: 'ORPHAN_FILE', severity: 'BLOCKER', ref: { fileId: f.fileId }, context: { fileId: f.fileId, name: f.name }, actions: ['ASSIGN_FILE', 'SKIP_FILE'] });
            continue;
        }
        if (d?.action === 'ASSIGN_FILE' && patientKeys.has(d.params?.sourceKey)) {
            fileLinks.push({ fileId: f.fileId, patientSourceKey: d.params.sourceKey, via: 'MANUAL' });
            add({ key, type: 'ORPHAN_FILE', severity: 'BLOCKER', ref: { fileId: f.fileId }, context: { fileId: f.fileId, name: f.name }, actions: ['ASSIGN_FILE', 'SKIP_FILE'] });
            continue;
        }
        const base = f.name.replace(/\.[^.]+$/, '');
        const digits = (0, normalize_1.latinDigits)(base);
        const cands = new Map();
        const offer = (rec, via, rank) => { const c = cands.get(rec.sourceKey); if (!c || rank > c.rank)
            cands.set(rec.sourceKey, { rec, via, rank }); };
        const dr = docByName.get(f.name.toLowerCase());
        const dp = dr ? resolveRef(dr.data.patientRef) : null;
        if (dp)
            offer(byId.get(dp.toLowerCase()), 'TABLE', 5);
        for (const m of digits.match(/\d{14}/g) ?? []) {
            const p = byNid.get(m);
            if (p)
                offer(p, 'NATIONAL_ID', 4);
        }
        for (const m of digits.match(/0?1[0125]\d{8}/g) ?? [])
            for (const p of byPhone.get(m.slice(-10)) ?? [])
                offer(p, 'PHONE', 3);
        for (const tok of base.split(/[^A-Za-z0-9؀-ۿ]+/)) {
            const p = tok.length >= 3 ? (byId.get(tok.toLowerCase()) ?? byId.get(tok.replace(/^[A-Za-z]{1,3}/, '').toLowerCase())) : undefined;
            if (p)
                offer(p, 'ID', 2);
        }
        const fk = (0, normalize_1.nameKey)(base);
        if (!cands.size && fk)
            for (const p of records.patients) {
                const nk = (0, normalize_1.nameKey)(p.data.fullName);
                const parts = nk.split(' ');
                if (nk && parts.length >= 2 && (fk.includes(nk) || parts.every((x) => fk.split(' ').includes(x))))
                    offer(p, 'NAME', 1);
            }
        const list = [...cands.values()].sort((a, b) => b.rank - a.rank);
        const top = list[0];
        const tied = list.filter((c) => c.rank === top?.rank);
        const ctx = { fileId: f.fileId, name: f.name, size: f.size };
        const sugg = { candidates: list.slice(0, 5).map((c) => ({ sourceKey: c.rec.sourceKey, name: (0, normalize_1.maskName)(c.rec.data.fullName), phone: (0, normalize_1.maskPhone)(c.rec.data.phone), via: c.via })) };
        if (!top)
            add({ key, type: 'ORPHAN_FILE', severity: 'BLOCKER', ref: { fileId: f.fileId }, context: ctx, actions: ['ASSIGN_FILE', 'SKIP_FILE'] });
        else if (tied.length > 1)
            add({ key, type: 'AMBIGUOUS_FILE', severity: 'BLOCKER', ref: { fileId: f.fileId }, context: ctx, suggestion: sugg, actions: ['ASSIGN_FILE', 'SKIP_FILE'] });
        else {
            fileLinks.push({ fileId: f.fileId, patientSourceKey: top.rec.sourceKey, via: top.via });
            if (top.via === 'NAME' || top.via === 'ID')
                add({ key, type: 'CONFIRM_FILE_MATCH', severity: 'WARNING', ref: { fileId: f.fileId }, context: ctx, suggestion: sugg, actions: ['ASSIGN_FILE', 'SKIP_FILE', 'IGNORE'] });
        }
    }
    for (const t of tasks)
        if (t.type === 'CONFIRM_FILE_MATCH' && t.status === 'RESOLVED') {
            const i = fileLinks.findIndex((l) => l.fileId === t.ref.fileId);
            if (i >= 0)
                fileLinks.splice(i, 1);
            if (t.resolution?.action === 'ASSIGN_FILE' && patientKeys.has(t.resolution.params?.sourceKey))
                fileLinks.push({ fileId: t.ref.fileId, patientSourceKey: t.resolution.params.sourceKey, via: 'MANUAL' });
            else
                skippedFiles.push(t.ref.fileId);
        }
    records.documents = fileLinks.map((l) => ({ sourceKey: `file:${l.fileId}`, data: { fileId: l.fileId, patientRef: l.patientSourceKey, via: l.via, fileName: inp.files.find((f) => f.fileId === l.fileId)?.name } }));
    for (const t of tasks)
        if (t.status === 'OPEN' && t.ref?.sourceKey && t.entity && dec.get(`skip:${t.entity}:${t.ref.sourceKey}`)?.action === 'SKIP_ROW') {
            t.status = 'RESOLVED';
            t.resolution = { action: 'SKIP_ROW' };
        }
    const open = tasks.filter((t) => t.status === 'OPEN');
    return { classification, mappings, records, fileLinks, skippedFiles, tasks, stats: { rows: Object.fromEntries(mapper_1.ENTITIES.map((e) => [e, records[e].length])), tasksOpen: open.length, blockers: open.filter((t) => t.severity === 'BLOCKER').length, warnings: open.filter((t) => t.severity === 'WARNING').length, filesMatched: fileLinks.length, filesTotal: inp.files.length, mergedPatients } };
}
//# sourceMappingURL=analyzer.js.map