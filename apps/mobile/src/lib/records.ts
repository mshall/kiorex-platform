/** Renders an arbitrary shared-content object (SOAP note / lab report meta) as label → value rows. Strings and numbers only; nested objects are flattened. */
export function flatten(o: unknown, prefix = ""): [string, string][] {
  if (o == null) return [];
  if (typeof o !== "object") return [[prefix, String(o)]];
  return Object.entries(o as Record<string, unknown>).flatMap(([k, v]) => (v != null && typeof v === "object" ? flatten(v, prefix ? `${prefix} · ${k}` : k) : v == null || v === "" ? [] : [[prefix ? `${prefix} · ${k}` : k, String(v)] as [string, string]]));
}

