"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.toMajor = exports.toMinor = void 0;
exports.newId = newId;
const node_crypto_1 = require("node:crypto");
function newId(prefix) {
    return `${prefix}_${Date.now().toString(36)}${(0, node_crypto_1.randomBytes)(8).toString('hex')}`;
}
const toMinor = (major) => Math.round(major * 100);
exports.toMinor = toMinor;
const toMajor = (minor) => minor / 100;
exports.toMajor = toMajor;
//# sourceMappingURL=ids.js.map