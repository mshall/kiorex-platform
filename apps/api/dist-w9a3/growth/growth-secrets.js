"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.subRefOf = exports.sha256Hex = exports.randomToken = exports.ipHashOf = exports.growthKey = exports.addressHash = void 0;
exports.linkTokenKey = linkTokenKey;
exports.providerLinkTouchSecret = providerLinkTouchSecret;
exports.growthSecretsStatus = growthSecretsStatus;
const config_1 = require("../common/config");
const privacy_hash_1 = require("../common/privacy-hash");
var privacy_hash_2 = require("../common/privacy-hash");
Object.defineProperty(exports, "addressHash", { enumerable: true, get: function () { return privacy_hash_2.addressHash; } });
Object.defineProperty(exports, "growthKey", { enumerable: true, get: function () { return privacy_hash_2.growthKey; } });
Object.defineProperty(exports, "ipHashOf", { enumerable: true, get: function () { return privacy_hash_2.ipHashOf; } });
Object.defineProperty(exports, "randomToken", { enumerable: true, get: function () { return privacy_hash_2.randomToken; } });
Object.defineProperty(exports, "sha256Hex", { enumerable: true, get: function () { return privacy_hash_2.sha256Hex; } });
Object.defineProperty(exports, "subRefOf", { enumerable: true, get: function () { return privacy_hash_2.subRefOf; } });
function linkTokenKey() {
    const env = process.env.GROWTH_LINK_TOKEN_SECRET;
    if (env && env.length >= 16)
        return Buffer.from(env, 'utf8');
    return (0, config_1.cfg)().isProd ? null : (0, privacy_hash_1.growthKey)('link-token');
}
function providerLinkTouchSecret() {
    const s = process.env.LINK_TOUCH_SIGNING_SECRET?.trim() || (0, config_1.cfg)().kiorlyWebhookSecret;
    return s ? s : null;
}
function growthSecretsStatus() {
    const env = process.env.GROWTH_LINK_TOKEN_SECRET;
    const lt = env && env.length >= 16 ? 'configured' : (0, config_1.cfg)().isProd ? 'missing' : 'dev-default';
    const pl = process.env.LINK_TOUCH_SIGNING_SECRET?.trim() ? 'configured' : (process.env.KIORLY_WEBHOOK_SECRET ? 'configured' : (0, config_1.cfg)().isProd ? 'missing' : 'dev-default');
    return { linkTokenSecret: lt, providerLinkTouchSecret: pl };
}
//# sourceMappingURL=growth-secrets.js.map