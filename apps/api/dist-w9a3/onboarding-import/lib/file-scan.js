"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.MALWARE_SCANNER = exports.MockMalwareScanner = exports.MAX_FILE_BYTES = void 0;
exports.sniff = sniff;
exports.scanUpload = scanUpload;
const node_crypto_1 = require("node:crypto");
exports.MAX_FILE_BYTES = { sql: 50 * 1024 * 1024, table: 25 * 1024 * 1024, patientFile: 15 * 1024 * 1024 };
function sniff(b) {
    const h = (n) => b.subarray(0, n).toString('hex');
    if (h(4) === '25504446')
        return 'pdf';
    if (h(3) === 'ffd8ff')
        return 'jpeg';
    if (h(8) === '89504e470d0a1a0a')
        return 'png';
    if (b.subarray(0, 4).toString() === 'RIFF' && b.subarray(8, 12).toString() === 'WEBP')
        return 'webp';
    if (b.subarray(4, 12).toString().startsWith('ftyp') && /heic|heix|mif1|heif/.test(b.subarray(8, 12).toString()))
        return 'heic';
    if (b.subarray(0, 3).toString() === 'GIF')
        return 'gif';
    if (h(4) === '49492a00' || h(4) === '4d4d002a')
        return 'tiff';
    if (h(2) === '4d5a' || h(4) === '7f454c46')
        return 'exe';
    if (h(4) === '504b0304')
        return b.includes(Buffer.from('xl/workbook.xml')) ? 'xlsx' : 'zip';
    const head = b.subarray(0, 4096);
    if (!head.includes(0))
        return 'text';
    if ((head[0] === 0xff && head[1] === 0xfe) || (head[0] === 0xfe && head[1] === 0xff))
        return 'text';
    return 'unknown';
}
class MockMalwareScanner {
    async scan(buf) { return buf.includes(Buffer.from('EICAR-STANDARD-ANTIVIRUS-TEST-FILE')) ? { clean: false, signature: 'EICAR-Test-File' } : { clean: true }; }
}
exports.MockMalwareScanner = MockMalwareScanner;
exports.MALWARE_SCANNER = Symbol('MALWARE_SCANNER');
const EXT_MIME = { pdf: ['pdf'], jpg: ['jpeg'], jpeg: ['jpeg'], png: ['png'], webp: ['webp'], heic: ['heic'], gif: ['gif'], tif: ['tiff'], tiff: ['tiff'], csv: ['text'], tsv: ['text'], sql: ['text'], txt: ['text'], xlsx: ['xlsx'] };
async function scanUpload(name, buf, scanner) {
    const sha256 = (0, node_crypto_1.createHash)('sha256').update(buf).digest('hex');
    const sniffed = sniff(buf);
    if (!buf.length)
        return { ok: false, reason: 'EMPTY', sniffed, sha256 };
    const ext = (name.split('.').pop() ?? '').toLowerCase();
    const allowed = EXT_MIME[ext];
    if (!allowed || sniffed === 'exe' || sniffed === 'zip' || sniffed === 'unknown')
        return { ok: false, reason: 'TYPE_NOT_ALLOWED', sniffed, sha256 };
    if (!allowed.includes(sniffed))
        return { ok: false, reason: 'MIME_MISMATCH', sniffed, sha256 };
    const cls = ext === 'sql' ? 'SQL' : ext === 'xlsx' ? 'XLSX' : ext === 'csv' || ext === 'tsv' || ext === 'txt' ? 'CSV' : 'PATIENT_FILE';
    const max = cls === 'SQL' ? exports.MAX_FILE_BYTES.sql : cls === 'PATIENT_FILE' ? exports.MAX_FILE_BYTES.patientFile : exports.MAX_FILE_BYTES.table;
    if (buf.length > max)
        return { ok: false, reason: 'TOO_LARGE', sniffed, sha256 };
    if (sniffed === 'pdf' && /\/(JavaScript|JS|Launch|EmbeddedFile)\b/.test(buf.subarray(0, Math.min(buf.length, 2_000_000)).toString('latin1')))
        return { ok: false, reason: 'ACTIVE_CONTENT', sniffed, sha256 };
    if (cls === 'CSV' && /^\s*[=+@-]\s*(cmd|HYPERLINK|DDE)/im.test(buf.subarray(0, 100_000).toString('utf8')))
        return { ok: false, reason: 'ACTIVE_CONTENT', sniffed, sha256 };
    const v = await scanner.scan(buf);
    if (!v.clean)
        return { ok: false, reason: 'MALWARE', sniffed, sha256 };
    return { ok: true, cls: cls, sniffed, sha256 };
}
//# sourceMappingURL=file-scan.js.map