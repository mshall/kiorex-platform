import { createHmac } from "node:crypto";

/** DEV-ONLY ops super admin TOTP seed (TEST_DATA.md); the dev IdP seeds the same value. Never a real secret. */
export const OPS_TOTP_SEED = process.env.OPS_TOTP_SEED ?? "REMOVED-OLD-DEMO-TOTP-SECRET";
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32 = (s: string) => { let bits = ""; for (const c of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0"); return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2))); };

/** RFC 6238 (SHA-1, 30 s, 6 digits). */
export function totpCode(seed = OPS_TOTP_SEED, at = Date.now()): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(seed)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
