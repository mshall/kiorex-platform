/** Field-level diff of two config payloads (diff view in the console). Pure; keys are JSON-pointer-like paths. */
export type DiffKind = 'added' | 'removed' | 'changed';
export interface DiffEntry { path: string; kind: DiffKind; before?: unknown; after?: unknown }

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function diffPayload(before: unknown, after: unknown, path = ''): DiffEntry[] {
  if (isObj(before) && isObj(after)) {
    const out: DiffEntry[] = [];
    for (const k of [...new Set([...Object.keys(before), ...Object.keys(after)])].sort()) {
      const p = `${path}/${k}`;
      if (!(k in before)) out.push({ path: p, kind: 'added', after: after[k] });
      else if (!(k in after)) out.push({ path: p, kind: 'removed', before: before[k] });
      else out.push(...diffPayload(before[k], after[k], p));
    }
    return out;
  }
  return JSON.stringify(before) === JSON.stringify(after) ? [] : [{ path: path || '/', kind: 'changed', before, after }];
}
