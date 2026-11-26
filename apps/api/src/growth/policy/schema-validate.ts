/**
 * Minimal JSON-Schema validator for the policy kinds (the subset the contract schemas use: type, properties, additionalProperties:false, minimum/maximum and their exclusive
 * forms, enum, items, pattern, maxItems). It exists to validate the contract kinds and the local Pay kinds without a JSON Schema library; the schemas themselves come from the vendored
 * @kiorex/contracts 1.13.0 (GROWTH_CONFIG_SCHEMAS) plus the Pay kinds in policy-schemas.ts. Errors are `/path message` strings and never contain a payload value that is not a number or an enum member.
 */
export type SchemaNode = {
  type?: string; properties?: Record<string, SchemaNode>; additionalProperties?: boolean; minimum?: number; maximum?: number; exclusiveMinimum?: number; exclusiveMaximum?: number;
  enum?: unknown[]; items?: SchemaNode; pattern?: string; maxItems?: number; default?: unknown; description?: string;
};

export function validateAgainst(schema: SchemaNode, value: unknown, path = ''): string[] {
  const here = path || '/';
  const t = schema.type;
  if (t === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return [`${here} must be an object`];
    const errors: string[] = []; const props = schema.properties ?? {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      if (!(k in props)) { if (schema.additionalProperties === false) errors.push(`${path}/${k} is not an allowed key`); continue; }
      errors.push(...validateAgainst(props[k]!, v, `${path}/${k}`));
    }
    return errors;
  }
  if (t === 'array') {
    if (!Array.isArray(value)) return [`${here} must be an array`];
    const errors: string[] = [];
    if (schema.maxItems !== undefined && value.length > schema.maxItems) errors.push(`${here} has more than ${schema.maxItems} items`);
    if (schema.items) value.forEach((x, i) => errors.push(...validateAgainst(schema.items!, x, `${path}/${i}`)));
    return errors;
  }
  if (t === 'integer' || t === 'number') {
    if (typeof value !== 'number' || !Number.isFinite(value)) return [`${here} must be a number`];
    if (t === 'integer' && !Number.isInteger(value)) return [`${here} must be an integer`];
    const errors: string[] = [];
    if (schema.minimum !== undefined && value < schema.minimum) errors.push(`${here} must be at least ${schema.minimum}`);
    if (schema.maximum !== undefined && value > schema.maximum) errors.push(`${here} must be at most ${schema.maximum}`);
    if (schema.exclusiveMinimum !== undefined && value <= schema.exclusiveMinimum) errors.push(`${here} must be greater than ${schema.exclusiveMinimum}`);
    if (schema.exclusiveMaximum !== undefined && value >= schema.exclusiveMaximum) errors.push(`${here} must be less than ${schema.exclusiveMaximum}`);
    return errors;
  }
  if (t === 'string') {
    if (typeof value !== 'string') return [`${here} must be a string`];
    if (schema.enum && !schema.enum.includes(value)) return [`${here} must be one of ${schema.enum.join(', ')}`];
    if (schema.pattern && !new RegExp(schema.pattern).test(value)) return [`${here} has the wrong format`];
    return [];
  }
  if (t === 'boolean') return typeof value === 'boolean' ? [] : [`${here} must be true or false`];
  return [];
}

/** Defaults declared in a schema (`default` on a property, or the merged defaults of a nested object). Properties without a default are left out. */
export function schemaDefaults(schema: SchemaNode): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, p] of Object.entries(schema.properties ?? {})) {
    if (p.default !== undefined) out[k] = JSON.parse(JSON.stringify(p.default));
    else if (p.type === 'object' && p.properties) { const d = schemaDefaults(p); if (Object.keys(d).length) out[k] = d; }
  }
  return out;
}

/** Deep merge of plain objects (arrays and scalars replace). */
export function deepMerge<T extends Record<string, unknown>>(base: T, over: Record<string, unknown> | undefined): T {
  if (!over) return base;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) {
    const b = out[k];
    out[k] = v && typeof v === 'object' && !Array.isArray(v) && b && typeof b === 'object' && !Array.isArray(b) ? deepMerge(b as Record<string, unknown>, v as Record<string, unknown>) : v;
  }
  return out as T;
}
