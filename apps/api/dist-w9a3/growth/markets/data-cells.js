"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.EMBEDDED_DATA_CELLS = void 0;
exports.loadDataCells = loadDataCells;
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
exports.EMBEDDED_DATA_CELLS = ['frankfurt', 'cairo'];
function loadDataCells(env = process.env) {
    const candidates = [env.DATA_CELLS_FILE, (0, node_path_1.resolve)(process.cwd(), '../../platform/data-cells.json'), (0, node_path_1.resolve)(process.cwd(), 'platform/data-cells.json')].filter((x) => !!x);
    for (const f of candidates) {
        if (!(0, node_fs_1.existsSync)(f))
            continue;
        try {
            const j = JSON.parse((0, node_fs_1.readFileSync)(f, 'utf8'));
            const cells = Object.keys(j.cells ?? {}).sort();
            if (cells.length)
                return { cells, source: 'FILE', deployed: cells.filter((c) => j.cells[c].status !== 'prepared-not-deployed'), bindings: Object.fromEntries(Object.entries(j.marketProductionBinding ?? {}).flatMap(([m, b]) => (b.hostCell ? [[m, b.hostCell]] : []))) };
        }
        catch { }
    }
    return { cells: [...exports.EMBEDDED_DATA_CELLS].sort(), source: 'EMBEDDED', deployed: ['frankfurt'], bindings: { EG: 'frankfurt' } };
}
//# sourceMappingURL=data-cells.js.map