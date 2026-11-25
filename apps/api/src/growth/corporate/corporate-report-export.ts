/**
 * Employer report export (gap closure, GRW-P4-C): the aggregate report of `CorporateReportService` as a CSV or a one-page PDF that ops hands to the employer (no employer login exists).
 * Pure: the input is the already masked report (every cell below k is `null`), the output is bytes. Nothing here can add detail: it prints what the report holds and nothing else
 * (no member, no booking, no provider, no specialty, no date of a single visit). A masked cell prints `<k`.
 */
export interface ExportReport {
  accountId: string; k: number; currency: string;
  enrolment: { enrolled: number | null; active: number | null; byVerification: Record<string, number | null> };
  utilisation: { membersWhoUsedBenefit: number | null; sponsoredVisits: number | null; sponsoredValueMinor: number | null };
  byMonth: { month: string; membersWhoUsedBenefit: number | null; sponsoredValueMinor: number | null }[];
  suppressed: string[];
}
export interface ExportMeta { company: string; generatedAt: Date }

const cell = (v: number | null, k: number): string => (v === null ? `<${k}` : String(v));
const money = (minor: number | null, k: number, cur: string): string => (minor === null ? `<${k}` : `${(minor / 100).toFixed(2)} ${cur}`);
/** CSV formula-injection guard: a text cell never starts with = + - @ tab or CR (a company name is typed by ops). */
export const csvText = (s: string): string => { const t = /^[=+\-@\t\r]/.test(s) ? `'${s}` : s; return /[",\n\r]/.test(t) ? `"${t.replace(/"/g, '""')}"` : t; };

export function rowsOf(r: ExportReport, m: ExportMeta): string[][] {
  const k = r.k; const rows: string[][] = [
    ['Kiorex employer benefit report', ''], ['Company', m.company], ['Generated (UTC)', m.generatedAt.toISOString().slice(0, 10)],
    ['Privacy rule', `Counts below ${k} are not shown (marked <${k}). No names, phone numbers, e-mail addresses or visit details are included.`], ['', ''],
    ['Enrolment', 'Count'], ['Members enrolled', cell(r.enrolment.enrolled, k)], ['Members active', cell(r.enrolment.active, k)],
    ...Object.entries(r.enrolment.byVerification).map(([way, n]) => [`Verified by ${way.toLowerCase().replace('_', ' ')}`, cell(n, k)]),
    ['', ''], ['Utilisation', 'Value'], ['Members who used the benefit', cell(r.utilisation.membersWhoUsedBenefit, k)], ['Sponsored visits', cell(r.utilisation.sponsoredVisits, k)],
    ['Sponsored value', money(r.utilisation.sponsoredValueMinor, k, r.currency)], ['', ''], ['Month', 'Members who used the benefit', 'Sponsored value'],
    ...r.byMonth.map((x) => [x.month, cell(x.membersWhoUsedBenefit, k), money(x.sponsoredValueMinor, k, r.currency)]),
  ];
  return rows;
}

export function reportToCsv(r: ExportReport, m: ExportMeta): string {
  const rows = rowsOf(r, m);
  return `\uFEFF${rows.map((row) => row.map(csvText).join(",")).join("\r\n")}\r\n`; // a byte-order mark so a spreadsheet opens the file as UTF-8
}

const esc = (s: string) => s.replace(/[^\x20-\x7e]/g, '?').replace(/([\\()])/g, '\\$1');

/** A one-page A4 PDF (Helvetica, Latin text; a company name with other scripts prints `?` for those characters until a font is embedded). */
export function reportToPdf(r: ExportReport, m: ExportMeta): Buffer {
  const lines = rowsOf(r, m).map((row) => row.filter((c) => c !== '').join('   '));
  const out: string[] = ['BT', '/F1 15 Tf', '50 790 Td', '18 TL'];
  lines.forEach((l, i) => { if (i === 1) out.push('/F1 10 Tf', '14 TL'); out.push(`(${esc(l.slice(0, 120))}) Tj`, 'T*'); });
  out.push('ET');
  const content = out.join('\n');
  const objs = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`,
  ];
  let pdf = '%PDF-1.4\n'; const offsets: number[] = [];
  objs.forEach((o, i) => { offsets.push(Buffer.byteLength(pdf, 'latin1')); pdf += `${i + 1} 0 obj\n${o}\nendobj\n`; });
  const xref = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n${offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n \n`).join('')}trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return Buffer.from(pdf, 'latin1');
}
