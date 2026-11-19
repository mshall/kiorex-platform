const B64 = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/** base64url → UTF-8 string (no atob dependency, works on Hermes, web and jest). */
export function b64urlDecode(input: string): string {
  const s = input.replace(/-/g, "+").replace(/_/g, "/").replace(/=+$/, "");
  const bytes: number[] = [];
  let buf = 0, bits = 0;
  for (const ch of s) {
    const v = B64.indexOf(ch);
    if (v < 0) throw new Error("bad base64");
    buf = (buf << 6) | v; bits += 6;
    if (bits >= 8) { bits -= 8; bytes.push((buf >> bits) & 0xff); }
  }
  return decodeURIComponent(bytes.map((b) => "%" + b.toString(16).padStart(2, "0")).join(""));
}

export interface Claims { sub: string; name?: string; phone_number?: string; locale?: string; exp?: number; kx_roles?: string[] }

/** Reads the (unverified) claims for display only. Authorization is always enforced server-side. */
export function decodeClaims(jwt: string | undefined | null): Claims | null {
  try {
    const part = jwt?.split(".")[1];
    return part ? (JSON.parse(b64urlDecode(part)) as Claims) : null;
  } catch { return null; }
}
