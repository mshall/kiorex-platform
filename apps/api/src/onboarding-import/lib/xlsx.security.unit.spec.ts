import { deflateRawSync } from 'node:zlib';
import { parseXlsx } from './xlsx';

/** Pentest 2026-11: the XLSX reader trusted the central-directory size, so entries that declared 0 bytes could each inflate MAX_UNZIPPED (zip bomb). */
function zip(entries: Array<{ name: string; data: Buffer; declared?: number }>): Buffer {
  const locals: Buffer[] = []; const centrals: Buffer[] = []; let offset = 0;
  for (const e of entries) {
    const comp = deflateRawSync(e.data); const name = Buffer.from(e.name); const usize = e.declared ?? e.data.length;
    const lh = Buffer.alloc(30); lh.writeUInt32LE(0x04034b50, 0); lh.writeUInt16LE(20, 4); lh.writeUInt16LE(8, 8); lh.writeUInt32LE(comp.length, 18); lh.writeUInt32LE(usize, 22); lh.writeUInt16LE(name.length, 26);
    const ch = Buffer.alloc(46); ch.writeUInt32LE(0x02014b50, 0); ch.writeUInt16LE(20, 4); ch.writeUInt16LE(20, 6); ch.writeUInt16LE(8, 10); ch.writeUInt32LE(comp.length, 20); ch.writeUInt32LE(usize, 24); ch.writeUInt16LE(name.length, 28); ch.writeUInt32LE(offset, 42);
    locals.push(lh, name, comp); centrals.push(ch, name); offset += 30 + name.length + comp.length;
  }
  const cd = Buffer.concat(centrals); const end = Buffer.alloc(22); end.writeUInt32LE(0x06054b50, 0); end.writeUInt16LE(entries.length, 8); end.writeUInt16LE(entries.length, 10); end.writeUInt32LE(cd.length, 12); end.writeUInt32LE(offset, 16);
  return Buffer.concat([...locals, cd, end]);
}

describe('xlsx zip-bomb guard (security)', () => {
  const sheet = (rows: string) => Buffer.from(`<worksheet><sheetData>${rows}</sheetData></worksheet>`);
  it('reads a normal workbook', () => {
    const buf = zip([{ name: 'xl/workbook.xml', data: Buffer.from('<workbook><sheets><sheet name="S" sheetId="1"/></sheets></workbook>') }, { name: 'xl/worksheets/sheet1.xml', data: sheet('<row r="1"><c r="A1" t="inlineStr"><is><t>hi</t></is></c></row>') }]);
    expect(parseXlsx(buf)).toHaveLength(1);
  });
  it('refuses many entries that each declare 0 bytes but inflate to 40 MB', () => {
    const big = Buffer.alloc(40 * 1024 * 1024, 0x20);
    const buf = zip(Array.from({ length: 4 }, (_, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, data: big, declared: 0 })));
    expect(buf.length).toBeLessThan(1_000_000);
    expect(() => parseXlsx(buf)).toThrow(/XLSX_TOO_LARGE/);
  });
  it('refuses a single entry that lies about its size and inflates beyond the cap', () => {
    const buf = zip([{ name: 'xl/worksheets/sheet1.xml', data: Buffer.alloc(70 * 1024 * 1024, 0x20), declared: 10 }]);
    expect(() => parseXlsx(buf)).toThrow(/XLSX_TOO_LARGE/);
  });
});
