"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.safetyTokens = safetyTokens;
const node_fs_1 = require("node:fs");
const node_module_1 = require("node:module");
let cached;
function safetyTokens() {
    if (cached)
        return cached;
    try {
        const req = (0, node_module_1.createRequire)(__filename);
        const file = req.resolve('@kiorex/contracts/package.json').replace('package.json', 'flags/safety-never-flags.json');
        const j = JSON.parse((0, node_fs_1.readFileSync)(file, 'utf8'));
        cached = j.items.flatMap((i) => i.forbiddenKeyTokens);
    }
    catch {
        cached = [];
    }
    return cached;
}
//# sourceMappingURL=safety-tokens.js.map