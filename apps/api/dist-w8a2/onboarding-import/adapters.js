"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.KiorlyImportTarget = exports.MockImportTarget = exports.LocalStagingStore = exports.IMPORT_TARGET = exports.STAGING_STORE = void 0;
const common_1 = require("@nestjs/common");
const node_crypto_1 = require("node:crypto");
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const kiorly_public_1 = require("../kiorly/kiorly-public");
exports.STAGING_STORE = Symbol('STAGING_STORE');
exports.IMPORT_TARGET = Symbol('IMPORT_TARGET');
let LocalStagingStore = class LocalStagingStore {
    root = () => process.env.ONBOARDING_STAGING_DIR ?? '.data/onboarding-staging';
    async put(batchId, fileId, bytes) { const dir = (0, node_path_1.join)(this.root(), batchId); await (0, promises_1.mkdir)(dir, { recursive: true }); const key = (0, node_path_1.join)(batchId, fileId); await (0, promises_1.writeFile)((0, node_path_1.join)(this.root(), key), bytes, { mode: 0o600 }); return key; }
    async get(key) { if (key.includes('..'))
        throw new Error('bad key'); return (0, promises_1.readFile)((0, node_path_1.join)(this.root(), key)); }
    async deleteBatch(batchId) { await (0, promises_1.rm)((0, node_path_1.join)(this.root(), batchId), { recursive: true, force: true }); }
};
exports.LocalStagingStore = LocalStagingStore;
exports.LocalStagingStore = LocalStagingStore = __decorate([
    (0, common_1.Injectable)()
], LocalStagingStore);
let MockImportTarget = class MockImportTarget {
    mode = 'mock';
    failAfter = null;
    committed = new Map();
    async commit(a) {
        const set = this.committed.get(a.batchId) ?? new Set();
        this.committed.set(a.batchId, set);
        const out = [];
        for (const it of a.items) {
            if (this.failAfter !== null) {
                if (this.failAfter <= 0) {
                    this.failAfter = null;
                    throw new Error('MOCK_TARGET_UNAVAILABLE');
                }
                this.failAfter--;
            }
            set.add(it.idempotencyKey);
            out.push({ sourceKey: it.sourceKey, targetId: `mock_${a.entity}_${(0, node_crypto_1.createHash)('sha1').update(it.idempotencyKey).digest('hex').slice(0, 12)}` });
        }
        return out;
    }
    async rollback(a) { const n = this.committed.get(a.batchId)?.size ?? 0; this.committed.delete(a.batchId); return { removed: n }; }
};
exports.MockImportTarget = MockImportTarget;
exports.MockImportTarget = MockImportTarget = __decorate([
    (0, common_1.Injectable)()
], MockImportTarget);
let KiorlyImportTarget = class KiorlyImportTarget {
    kiorly;
    mode = 'kiorly';
    constructor(kiorly) {
        this.kiorly = kiorly;
    }
    async commit(a) {
        const r = await this.kiorly.importRecords(a.batchId, { orgId: a.orgId, orgName: a.orgName, entity: a.entity, items: a.items });
        return r.data.results;
    }
    async rollback(a) { const r = await this.kiorly.importRollback(a.batchId, { orgId: a.orgId }); return { removed: r.data.removed }; }
};
exports.KiorlyImportTarget = KiorlyImportTarget;
exports.KiorlyImportTarget = KiorlyImportTarget = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [kiorly_public_1.KiorlyClient])
], KiorlyImportTarget);
//# sourceMappingURL=adapters.js.map