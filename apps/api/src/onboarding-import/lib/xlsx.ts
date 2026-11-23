import { inflateRawSync } from 'node:zlib';
import type { ParsedTable } from './csv';

/** Tiny XLSX reader (zip + sharedStrings + sheet XML). Zip bomb guarded; no macros/external refs are ever evaluated. */
const MAX_UNZIPPED = 60 * 1024 * 1024;

function unzip(buf: Buffer): Map<string, Buffer> {
  const out = new Map<string, Buffer>();
  let eocd = -1;
  for (let i = buf.length - 22; i >= Math.max(0, buf.length - 65_557); i--) if (buf.readUInt32LE(i) === 0x06054b50) { eocd = i; break; }
  if (eocd < 0) throw new Error('XLSX_BAD_ZIP');
  let off = buf.readUInt32LE(eocd + 16); const n = buf.readUInt16LE(eocd + 10); let total = 0;
  for (let k = 0; k < n; k++) {
    if (buf.readUInt32LE(off) !== 0x02014b50) throw new Error('XLSX_BAD_ZIP');
    const method = buf.readUInt16LE(off + 10); const csize = buf.readUInt32LE(off + 20); const usize = buf.readUInt32LE(off + 24);
    const nlen = buf.readUInt16LE(off + 28); const elen = buf.readUInt16LE(off + 30); const clen = buf.readUInt16LE(off + 32); const lho = buf.readUInt32LE(off + 42);
    const name = buf.subarray(off + 46, off + 46 + nlen).toString('utf8');
    off += 46 + nlen + elen + clen;
    if (!/^xl\/(worksheets\/[^/]+\.xml|sharedStrings\.xml|workbook\.xml|_rels\/workbook\.xml\.rels)$/.test(name)) continue;
    total += usize; if (total > MAX_UNZIPPED) throw new Error('XLSX_TOO_LARGE');
    const lnlen = buf.readUInt16LE(lho + 26); const lelen = buf.readUInt16LE(lho + 28);
    const data = buf.subarray(lho + 30 + lnlen + lelen, lho + 30 + lnlen + lelen + csize);
    out.set(name, method === 0 ? data : inflateRawSync(data, { maxOutputLength: MAX_UNZIPPED }));
  }
  return out;
}
const unesc = (s: string) => s.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(+d)).replace(/&amp;/g, '&');
const colIndex = (ref: string) => { let n = 0; for (const c of ref.replace(/\d+/g, '')) n = n * 26 + c.charCodeAt(0) - 64; return n - 1; };

export function parseXlsx(buf: Buffer, baseName = 'sheet', maxRows = 100_000): ParsedTable[] {
  const files = unzip(buf);
  const shared: string[] = [];
  const ss = files.get('xl/sharedStrings.xml')?.toString('utf8') ?? '';
  for (const m of ss.matchAll(/<si>([\s\S]*?)<\/si>/g)) shared.push(unesc([...m[1].matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join('')));
  const wb = files.get('xl/workbook.xml')?.toString('utf8') ?? '';
  const names = [...wb.matchAll(/<sheet [^>]*name="([^"]*)"/g)].map((m) => unesc(m[1]));
  const sheets = [...files.keys()].filter((k) => k.startsWith('xl/worksheets/')).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
  return sheets.map((key, si) => {
    const xml = files.get(key)!.toString('utf8');
    const grid: string[][] = [];
    for (const rm of xml.matchAll(/<row[^>]*>([\s\S]*?)<\/row>/g)) {
      const r: string[] = [];
      for (const cm of rm[1].matchAll(/<c ([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const ref = /r="([A-Z]+\d+)"/.exec(cm[1])?.[1]; const t = /t="(\w+)"/.exec(cm[1])?.[1];
        const body = cm[2] ?? ''; const v = /<v>([\s\S]*?)<\/v>/.exec(body)?.[1];
        let val = '';
        if (t === 'inlineStr') val = unesc([...body.matchAll(/<t[^>]*>([\s\S]*?)<\/t>/g)].map((x) => x[1]).join(''));
        else if (v !== undefined) val = t === 's' ? shared[+v] ?? '' : unesc(v);
        r[ref ? colIndex(ref) : r.length] = val;
      }
      grid.push(Array.from(r, (x) => x ?? ''));
      if (grid.length > maxRows + 1) break;
    }
    const header = (grid.shift() ?? []).map((h, ix) => (h.trim() || `col_${ix + 1}`));
    const rows = grid.slice(0, maxRows).map((r) => Object.fromEntries(header.map((h, ix) => [h, r[ix] === undefined || r[ix] === '' ? null : r[ix]])));
    return { name: names[si] ?? `${baseName}_${si + 1}`, columns: header, rows };
  });
}
