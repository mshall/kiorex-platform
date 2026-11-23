/** Minimal RFC-4180 CSV/TSV reader. Pure: never touches the filesystem. */
export interface ParsedTable { name: string; columns: string[]; rows: Array<Record<string, string | null>>; truncated?: boolean }

export function detectDelimiter(sample: string): string {
  const line = sample.split(/\r?\n/).find((l) => l.trim().length) ?? '';
  const counts = [',', ';', '\t', '|'].map((d) => [d, line.split(d).length - 1] as const);
  counts.sort((a, b) => b[1] - a[1]);
  return counts[0][1] > 0 ? counts[0][0] : ',';
}

export function parseCsv(text: string, name = 'csv', maxRows = 200_000): ParsedTable {
  if (text.charCodeAt(0) === 0xfeff) text = text.slice(1);
  const delim = detectDelimiter(text.slice(0, 4096));
  const records: string[][] = [];
  let row: string[] = []; let cur = ''; let inQ = false; let i = 0;
  const pushCell = () => { row.push(cur); cur = ''; };
  const pushRow = () => { pushCell(); if (!(row.length === 1 && row[0] === '')) records.push(row); row = []; };
  for (; i < text.length; i++) {
    const ch = text[i];
    if (inQ) {
      if (ch === '"') { if (text[i + 1] === '"') { cur += '"'; i++; } else inQ = false; } else cur += ch;
    } else if (ch === '"' && cur === '') inQ = true;
    else if (ch === delim) pushCell();
    else if (ch === '\n') pushRow();
    else if (ch === '\r') { if (text[i + 1] === '\n') i++; pushRow(); }
    else cur += ch;
    if (records.length > maxRows + 1) break;
  }
  if (cur !== '' || row.length) pushRow();
  const header = (records.shift() ?? []).map((h, ix) => (h.trim() || `col_${ix + 1}`));
  const truncated = records.length > maxRows;
  const rows = records.slice(0, maxRows).map((r) => Object.fromEntries(header.map((h, ix) => [h, r[ix] === undefined || r[ix] === '' ? null : r[ix]])));
  return { name, columns: header, rows, truncated };
}
