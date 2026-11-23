/** Decode bytes to text and report encoding problems without ever logging content. */
export interface DecodeResult { text: string; encoding: 'utf-8' | 'utf-8-bom' | 'utf-16le' | 'utf-16be' | 'windows-1256' | 'latin1'; issues: Array<'INVALID_UTF8' | 'MOJIBAKE' | 'REPLACEMENT_CHARS' | 'NUL_BYTES'> }

const MOJIBAKE = /(Ã.|Ø.|Ù.|Ú.|Û.|â€.|ï»¿)/;

export function decodeText(buf: Buffer): DecodeResult {
  if (buf[0] === 0xff && buf[1] === 0xfe) return { text: buf.subarray(2).toString('utf16le'), encoding: 'utf-16le', issues: [] };
  if (buf[0] === 0xfe && buf[1] === 0xff) { const sw = Buffer.from(buf.subarray(2)).swap16(); return { text: sw.toString('utf16le'), encoding: 'utf-16be', issues: [] }; }
  const issues: DecodeResult['issues'] = [];
  if (buf.includes(0)) issues.push('NUL_BYTES');
  const bom = buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf;
  try {
    const text = new TextDecoder('utf-8', { fatal: true }).decode(bom ? buf.subarray(3) : buf);
    if (MOJIBAKE.test(text)) issues.push('MOJIBAKE');
    return { text, encoding: bom ? 'utf-8-bom' : 'utf-8', issues };
  } catch {
    issues.push('INVALID_UTF8');
    // Legacy Arabic dumps are very often windows-1256; fall back to it when available, else latin1.
    try { return { text: new TextDecoder('windows-1256').decode(buf), encoding: 'windows-1256', issues }; }
    catch { return { text: buf.toString('latin1'), encoding: 'latin1', issues }; }
  }
}

/** Try to repair double-encoded UTF-8 ("Ø£Ø­Ù…Ø¯" -> "أحمد"). Returns null if not repairable. */
export function repairMojibake(s: string): string | null {
  if (!MOJIBAKE.test(s)) return null;
  try {
    const fixed = new TextDecoder('utf-8', { fatal: true }).decode(Buffer.from(s, 'latin1'));
    return fixed !== s && !MOJIBAKE.test(fixed) ? fixed : null;
  } catch { return null; }
}
export const hasMojibake = (s: string) => MOJIBAKE.test(s);
