import { csvText, reportToCsv, reportToPdf, rowsOf, type ExportReport } from './corporate-report-export';

const report = (o: Partial<ExportReport> = {}): ExportReport => ({
  accountId: 'cacc_1', k: 10, currency: 'EGP',
  enrolment: { enrolled: 120, active: 100, byVerification: { CODE: 80, HR_LIST: 40, DOMAIN_EMAIL: null } },
  utilisation: { membersWhoUsedBenefit: 35, sponsoredVisits: 52, sponsoredValueMinor: 1_040_000 },
  byMonth: [{ month: '2027-01', membersWhoUsedBenefit: 12, sponsoredValueMinor: 240_000 }, { month: '2027-02', membersWhoUsedBenefit: null, sponsoredValueMinor: null }],
  suppressed: ['enrolment.byVerification.DOMAIN_EMAIL'], ...o,
});
const meta = { company: 'Acme Corp', generatedAt: new Date('2027-03-01T10:00:00Z') };

describe('employer report export (CSV and PDF)', () => {
  it('prints the masked report: a hidden cell is "<k", never a number, and values are formatted', () => {
    const csv = reportToCsv(report(), meta);
    expect(csv).toContain('Company,Acme Corp');
    expect(csv).toContain('Members enrolled,120');
    expect(csv).toContain('Verified by domain email,<10');
    expect(csv).toContain('2027-02,<10,<10');
    expect(csv).toContain('Sponsored value,10400.00 EGP');
    expect(csv.startsWith('﻿')).toBe(true);
  });
  it('contains nothing but the report: no member, booking, phone, e-mail, provider or specialty column exists', () => {
    const text = rowsOf(report(), meta).filter((r) => r[0] !== 'Privacy rule').flat().join(' ');
    expect(text).not.toMatch(/phone|booking|member id|@|provider|specialty|diagnos/i);
    expect(rowsOf(report(), meta).map((r) => r.length).sort().pop()).toBeLessThanOrEqual(3);
  });
  it('a company name typed by ops cannot inject a spreadsheet formula, and quotes and commas are escaped', () => {
    expect(csvText('=HYPERLINK("http://x")')).toBe(`"'=HYPERLINK(""http://x"")"`);
    expect(csvText('+1')).toBe("'+1"); expect(csvText('a,b')).toBe('"a,b"'); expect(csvText('plain')).toBe('plain');
    expect(reportToCsv(report(), { ...meta, company: '@evil' })).toContain("Company,'@evil");
  });
  it('the PDF is a valid one-page document with the same figures and no raw backslash or parenthesis breaking the stream', () => {
    const pdf = reportToPdf(report(), { ...meta, company: 'Acme (Egypt) \\ Ltd' });
    const text = pdf.toString('latin1');
    expect(text.startsWith('%PDF-1.4')).toBe(true); expect(text.trimEnd().endsWith('%%EOF')).toBe(true);
    expect(text).toContain('/Count 1'); expect(text).toContain('Members enrolled   120'); expect(text).toContain('Acme \\(Egypt\\) \\\\ Ltd');
    const startxref = Number(/startxref\n(\d+)/.exec(text)![1]); expect(text.slice(startxref, startxref + 4)).toBe('xref');
  });
  it('non-Latin characters print as ? in the PDF (no font embedded) and never break it', () => {
    const t = reportToPdf(report(), { ...meta, company: 'شركة' }).toString('latin1');
    expect(t).toContain('Company   ????');
  });
});
