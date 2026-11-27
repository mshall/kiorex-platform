/** CSV for the leads export: RFC 4180 quoting, UTF-8 with a BOM so Excel shows Arabic correctly, and formula-injection protection (a cell starting with = + - @ or a tab is prefixed with an apostrophe). */
export function csvCell(v: unknown): string {
  let s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('; ') : v instanceof Date ? v.toISOString() : String(v);
  if (/^[=+\-@\t\r]/.test(s) && !/^\+\d{6,15}$/.test(s)) s = `'${s}`; // an E.164 phone number is the one safe value that starts with +
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
export function toCsv(headers: string[], rows: unknown[][]): string {
  return `﻿${[headers, ...rows].map((r) => r.map(csvCell).join(',')).join('\r\n')}\r\n`;
}
