"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.factRef = void 0;
const node_crypto_1 = require("node:crypto");
const privacy_hash_1 = require("../../common/privacy-hash");
const factRef = (kind, id) => (0, node_crypto_1.createHmac)('sha256', (0, privacy_hash_1.growthKey)('cross-product:fact')).update(`${kind}:${id}`).digest('hex').slice(0, 32);
exports.factRef = factRef;
//# sourceMappingURL=continuity-refs.js.map