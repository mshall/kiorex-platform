import { createHmac } from "node:crypto";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * LOCAL-ONLY TOTP seed of a seeded Passport ops account. The seed file carries none: the local Passport generates a random one per machine into
 * kiorex-account/.local/totp-secrets.json (git-ignored; `cd kiorex-account && npm run dev:totp-secrets`). OPS_TOTP_SEED (super admin) or KX_LOCAL_TOTP_FILE override.
 */
export function localTotpSeed(phone: string): string {
  if (phone === "+201000000099" && process.env.OPS_TOTP_SEED) return process.env.OPS_TOTP_SEED;
  const file = process.env.KX_LOCAL_TOTP_FILE ?? path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../../../kiorex-account/.local/totp-secrets.json");
  if (!existsSync(file)) throw new Error(`no local TOTP secrets file (${file}): run \`cd kiorex-account && npm run dev:totp-secrets\` (local-only, generated per machine)`);
  const s = (JSON.parse(readFileSync(file, "utf8")) as { secrets?: Record<string, string> }).secrets?.[phone];
  if (!s) throw new Error(`no local TOTP secret for ${phone} in ${file}`);
  return s;
}

/** Local-only ops super admin TOTP seed (generated per machine, never committed). */
export const OPS_TOTP_SEED = () => localTotpSeed("+201000000099");
const B32 = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const base32 = (s: string) => { let bits = ""; for (const c of s.replace(/=+$/, "").toUpperCase()) bits += B32.indexOf(c).toString(2).padStart(5, "0"); return Buffer.from(bits.match(/.{8}/g)!.map((b) => parseInt(b, 2))); };

/** RFC 6238 (SHA-1, 30 s, 6 digits). */
export function totpCode(seed = OPS_TOTP_SEED(), at = Date.now()): string {
  const counter = Buffer.alloc(8); counter.writeBigUInt64BE(BigInt(Math.floor(at / 30_000)));
  const h = createHmac("sha1", base32(seed)).update(counter).digest();
  const o = h[h.length - 1] & 0xf;
  return String(((h.readUInt32BE(o) & 0x7fffffff) % 1_000_000)).padStart(6, "0");
}
