"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.splitStatements = splitStatements;
exports.parseSqlDump = parseSqlDump;
const unq = (s) => s.trim().replace(/^[`"\[]|[`"\]]$/g, '');
const tableName = (s) => unq(s.trim().split('.').pop() ?? s);
function splitStatements(sql) {
    const out = [];
    let cur = '';
    let i = 0;
    const n = sql.length;
    while (i < n) {
        const c = sql[i];
        const d = sql[i + 1];
        if (c === '-' && d === '-') {
            while (i < n && sql[i] !== '\n')
                i++;
            continue;
        }
        if (c === '#' && cur.trim() === '') {
            while (i < n && sql[i] !== '\n')
                i++;
            continue;
        }
        if (c === '/' && d === '*') {
            const e = sql.indexOf('*/', i + 2);
            i = e < 0 ? n : e + 2;
            continue;
        }
        if (c === "'") {
            cur += c;
            i++;
            while (i < n) {
                cur += sql[i];
                if (sql[i] === '\\') {
                    cur += sql[i + 1] ?? '';
                    i += 2;
                    continue;
                }
                if (sql[i] === "'") {
                    if (sql[i + 1] === "'") {
                        cur += "'";
                        i += 2;
                        continue;
                    }
                    i++;
                    break;
                }
                i++;
            }
            continue;
        }
        if (c === '"' || c === '`') {
            const q = c;
            cur += c;
            i++;
            while (i < n && sql[i] !== q) {
                cur += sql[i++];
            }
            cur += sql[i] ?? '';
            i++;
            continue;
        }
        if (c === '$' && /^\$[A-Za-z_]*\$/.test(sql.slice(i, i + 40))) {
            const tag = /^\$[A-Za-z_]*\$/.exec(sql.slice(i, i + 40))[0];
            const e = sql.indexOf(tag, i + tag.length);
            const stop = e < 0 ? n : e + tag.length;
            cur += sql.slice(i, stop);
            i = stop;
            continue;
        }
        if (c === ';') {
            const st = cur.trim();
            cur = '';
            i++;
            if (/^COPY\s/i.test(st) && /FROM\s+stdin/i.test(st)) {
                const nl = sql.indexOf('\n', i);
                const endMarker = sql.indexOf('\n\\.', i);
                const stop = endMarker < 0 ? n : endMarker;
                out.push(st + '\n' + sql.slice(nl < 0 ? i : nl + 1, stop));
                i = endMarker < 0 ? n : endMarker + 3;
            }
            else if (st)
                out.push(st);
            continue;
        }
        cur += c;
        i++;
    }
    if (cur.trim())
        out.push(cur.trim());
    return out;
}
function parseValueTuples(s) {
    const rows = [];
    let i = 0;
    const n = s.length;
    while (i < n) {
        while (i < n && s[i] !== '(')
            i++;
        if (i >= n)
            break;
        i++;
        const row = [];
        let cur = '';
        let isStr = false;
        let started = false;
        const flush = () => { const t = cur.trim(); row.push(isStr ? cur : (t === '' || /^null$/i.test(t) ? null : t)); cur = ''; isStr = false; started = false; };
        while (i < n) {
            const c = s[i];
            if (c === "'") {
                isStr = true;
                started = true;
                i++;
                while (i < n) {
                    if (s[i] === '\\') {
                        const e = s[i + 1];
                        cur += e === 'n' ? '\n' : e === 'r' ? '\r' : e === 't' ? '\t' : e === '0' ? '\0' : e;
                        i += 2;
                        continue;
                    }
                    if (s[i] === "'") {
                        if (s[i + 1] === "'") {
                            cur += "'";
                            i += 2;
                            continue;
                        }
                        i++;
                        break;
                    }
                    cur += s[i++];
                }
                continue;
            }
            if (c === ',') {
                flush();
                i++;
                continue;
            }
            if (c === ')') {
                flush();
                i++;
                break;
            }
            if (c === '(') {
                let depth = 0;
                while (i < n) {
                    cur += s[i];
                    if (s[i] === '(')
                        depth++;
                    else if (s[i] === ')') {
                        depth--;
                        if (!depth) {
                            i++;
                            break;
                        }
                    }
                    i++;
                }
                started = true;
                continue;
            }
            if (!started && /\s/.test(c)) {
                i++;
                continue;
            }
            started = true;
            cur += c;
            i++;
        }
        rows.push(row);
    }
    return rows;
}
const splitCols = (s) => s.split(',').map(unq).filter(Boolean);
function parseSqlDump(sql, maxRowsPerTable = 200_000) {
    const stmts = splitStatements(sql);
    const dialect = /ENGINE\s*=|`[a-z_]+`\s/i.test(sql.slice(0, 20000)) ? 'mysql' : /\bCOPY\b|::[a-z]+|SET\s+search_path|pg_catalog/i.test(sql.slice(0, 20000)) ? 'postgres' : 'generic';
    const schemas = new Map();
    const data = new Map();
    const skipped = {};
    const dangerous = [];
    const table = (name, cols) => { let t = data.get(name); if (!t) {
        t = { name, columns: cols, rows: [] };
        data.set(name, t);
    } return t; };
    for (const st of stmts) {
        const head = /^\s*([A-Za-z]+(?:\s+[A-Za-z]+)?)/.exec(st)?.[1].toUpperCase() ?? 'UNKNOWN';
        const ct = /^CREATE\s+(?:TEMPORARY\s+)?TABLE\s+(?:IF\s+NOT\s+EXISTS\s+)?([^\s(]+)\s*\(([\s\S]*)\)[^)]*$/i.exec(st);
        if (ct) {
            const cols = [];
            let depth = 0;
            let cur = '';
            const parts = [];
            for (const ch of ct[2]) {
                if (ch === '(')
                    depth++;
                if (ch === ')')
                    depth--;
                if (ch === ',' && depth === 0) {
                    parts.push(cur);
                    cur = '';
                }
                else
                    cur += ch;
            }
            parts.push(cur);
            for (const p of parts) {
                const w = p.trim();
                if (!w || /^(PRIMARY|KEY|UNIQUE|CONSTRAINT|FOREIGN|INDEX|FULLTEXT|CHECK)\b/i.test(w))
                    continue;
                cols.push(unq(w.split(/\s+/)[0]));
            }
            schemas.set(tableName(ct[1]), cols);
            continue;
        }
        const ins = /^INSERT\s+(?:IGNORE\s+)?INTO\s+([^\s(]+)\s*(?:\(([^)]*)\))?\s*VALUES\s*([\s\S]*)$/i.exec(st);
        if (ins) {
            const name = tableName(ins[1]);
            const cols = ins[2] ? splitCols(ins[2]) : schemas.get(name) ?? [];
            const t = table(name, cols);
            if (!t.columns.length)
                t.columns = cols;
            for (const tup of parseValueTuples(ins[3])) {
                if (t.rows.length >= maxRowsPerTable) {
                    t.truncated = true;
                    break;
                }
                const colsNow = t.columns.length ? t.columns : tup.map((_, ix) => `col_${ix + 1}`);
                if (!t.columns.length)
                    t.columns = colsNow;
                t.rows.push(Object.fromEntries(colsNow.map((c, ix) => [c, tup[ix] ?? null])));
            }
            continue;
        }
        const cp = /^COPY\s+([^\s(]+)\s*\(([^)]*)\)\s+FROM\s+stdin[^\n]*\n([\s\S]*)$/i.exec(st);
        if (cp) {
            const name = tableName(cp[1]);
            const cols = splitCols(cp[2]);
            const t = table(name, cols);
            for (const line of cp[3].split('\n')) {
                if (!line)
                    continue;
                if (t.rows.length >= maxRowsPerTable) {
                    t.truncated = true;
                    break;
                }
                const cells = line.split('\t').map((c) => (c === '\\N' ? null : c.replace(/\\t/g, '\t').replace(/\\n/g, '\n').replace(/\\\\/g, '\\')));
                t.rows.push(Object.fromEntries(cols.map((c, ix) => [c, cells[ix] ?? null])));
            }
            continue;
        }
        skipped[head] = (skipped[head] ?? 0) + 1;
        if (/^(DROP|TRUNCATE|GRANT|REVOKE|ALTER\s+(USER|ROLE)|CREATE\s+(USER|ROLE|FUNCTION|PROCEDURE|TRIGGER|EVENT)|LOAD\s+DATA|COPY)/i.test(st) || /\b(xp_cmdshell|pg_read_file|lo_import|INTO\s+OUTFILE|COPY\b[\s\S]*PROGRAM)\b/i.test(st))
            dangerous.push(head);
    }
    for (const [name, cols] of schemas)
        if (!data.has(name))
            data.set(name, { name, columns: cols, rows: [] });
    return { tables: [...data.values()], dialect, statements: stmts.length, skipped, dangerous: [...new Set(dangerous)] };
}
//# sourceMappingURL=sql-parser.js.map