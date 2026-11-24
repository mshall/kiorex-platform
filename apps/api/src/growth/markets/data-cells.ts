import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';

/**
 * Data-residency cells (GRW-P3-G step 7). The source of truth is `platform/data-cells.json` at the repository root; a build that does not ship that file uses the
 * embedded list (a unit test asserts the two agree). An unknown cell is refused. With one live cell, a second market maps to it: cross-cell routing does not exist until a second cell does.
 */
export const EMBEDDED_DATA_CELLS = ['frankfurt', 'cairo'] as const;
export interface DataCells { cells: string[]; source: 'FILE' | 'EMBEDDED'; deployed: string[]; bindings: Record<string, string> }
export function loadDataCells(env: NodeJS.ProcessEnv = process.env): DataCells {
  const candidates = [env.DATA_CELLS_FILE, resolve(process.cwd(), '../../platform/data-cells.json'), resolve(process.cwd(), 'platform/data-cells.json')].filter((x): x is string => !!x);
  for (const f of candidates) {
    if (!existsSync(f)) continue;
    try {
      const j = JSON.parse(readFileSync(f, 'utf8')) as { cells?: Record<string, { status?: string }>; marketProductionBinding?: Record<string, { hostCell?: string }> };
      const cells = Object.keys(j.cells ?? {}).sort(); if (cells.length) return { cells, source: 'FILE', deployed: cells.filter((c) => j.cells![c]!.status !== 'prepared-not-deployed'), bindings: Object.fromEntries(Object.entries(j.marketProductionBinding ?? {}).flatMap(([m, b]) => (b.hostCell ? [[m, b.hostCell]] : []))) };
    } catch { /* fall through to the embedded list */ }
  }
  return { cells: [...EMBEDDED_DATA_CELLS].sort(), source: 'EMBEDDED', deployed: ['frankfurt'], bindings: { EG: 'frankfurt' } };
}
