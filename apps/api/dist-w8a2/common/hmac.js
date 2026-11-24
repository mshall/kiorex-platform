"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.HMAC_MAX_SKEW_MS = exports.verifyControlPlaneRequest = exports.signKiorlyRequest = exports.signCanonical = exports.sha256BodyHex = exports.canonicalString = void 0;
exports.signWebhook = signWebhook;
exports.verifyWebhook = verifyWebhook;
const contracts_1 = require("@kiorex/contracts");
Object.defineProperty(exports, "canonicalString", { enumerable: true, get: function () { return contracts_1.kiorlyCanonicalString; } });
Object.defineProperty(exports, "sha256BodyHex", { enumerable: true, get: function () { return contracts_1.sha256BodyHex; } });
Object.defineProperty(exports, "signCanonical", { enumerable: true, get: function () { return contracts_1.signCanonical; } });
Object.defineProperty(exports, "signKiorlyRequest", { enumerable: true, get: function () { return contracts_1.signKiorlyRequest; } });
Object.defineProperty(exports, "verifyControlPlaneRequest", { enumerable: true, get: function () { return contracts_1.verifyControlPlaneRequest; } });
exports.HMAC_MAX_SKEW_MS = 5 * 60 * 1000;
function signWebhook(secret, timestampSeconds, rawBody) {
    return (0, contracts_1.signWebhook)({ secret, body: rawBody, timestamp: Number(timestampSeconds) }).signature;
}
function verifyWebhook(secret, signature, rawBody, timestamp) {
    return (0, contracts_1.verifyWebhook)({ secret, body: rawBody, timestamp, signature }).ok;
}
//# sourceMappingURL=hmac.js.map