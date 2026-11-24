"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.orphan = orphan;
function orphan(p, c) {
    if (p.templateKind === 'home')
        return [{ id: 'orphan', ok: true, severity: 'warn' }];
    return c.orphans.has(p.pageKey) ? [{ id: 'orphan', ok: false, severity: 'warn', detail: 'no inbound internal link' }] : [{ id: 'orphan', ok: true, severity: 'warn' }];
}
//# sourceMappingURL=orphan.js.map