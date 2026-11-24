"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.storageAdapter = exports.STORAGE = exports.UnconfiguredStorageAdapter = exports.LocalStorageAdapter = void 0;
const promises_1 = require("node:fs/promises");
const node_path_1 = require("node:path");
const config_1 = require("../common/config");
const crypto_1 = require("../common/crypto");
class LocalStorageAdapter {
    mode = 'local';
    path(key) {
        const root = (0, node_path_1.resolve)((0, config_1.cfg)().storageLocalDir);
        const p = (0, node_path_1.resolve)(root, key);
        if (!p.startsWith(root + node_path_1.sep))
            throw new Error('invalid storage key');
        return p;
    }
    async put(key, plain) {
        const p = this.path(key);
        await (0, promises_1.mkdir)((0, node_path_1.dirname)(p), { recursive: true });
        await (0, promises_1.writeFile)(p, (0, crypto_1.encryptBytes)(plain));
    }
    async get(key) { return (0, crypto_1.decryptBytes)(await (0, promises_1.readFile)(this.path(key))); }
    async delete(key) { await (0, promises_1.rm)(this.path(key), { force: true }); }
}
exports.LocalStorageAdapter = LocalStorageAdapter;
class UnconfiguredStorageAdapter {
    mode = 's3';
    async put() { throw new Error('NEEDS_HUMAN: object storage (S3 + KMS) not configured'); }
    async get() { throw new Error('NEEDS_HUMAN: object storage (S3 + KMS) not configured'); }
    async delete() { throw new Error('NEEDS_HUMAN: object storage (S3 + KMS) not configured'); }
}
exports.UnconfiguredStorageAdapter = UnconfiguredStorageAdapter;
exports.STORAGE = Symbol('KX_STORAGE');
const storageAdapter = () => ((0, config_1.cfg)().storageMode === 's3' ? new UnconfiguredStorageAdapter() : new LocalStorageAdapter());
exports.storageAdapter = storageAdapter;
//# sourceMappingURL=storage.js.map