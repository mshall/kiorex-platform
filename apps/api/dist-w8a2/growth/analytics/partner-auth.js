"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.authenticatePartnerOrg = authenticatePartnerOrg;
const contracts_1 = require("@kiorex/contracts");
const node_crypto_1 = require("node:crypto");
const config_1 = require("../../common/config");
const errors_1 = require("../../common/errors");
const one = (v) => (Array.isArray(v) ? v[0] : v);
async function authenticatePartnerOrg(req, prisma, scope) {
    if (!req.headers['x-kiorly-signature'])
        throw new errors_1.ApiError(401, 'UNAUTHENTICATED', 'A signed partner request is required');
    const c = (0, config_1.cfg)();
    const v = one(req.headers['x-kiorly-client-key']) === c.kiorlyClientKey ? (0, contracts_1.verifyKiorlyRequest)({ headers: req.headers, method: req.method, path: req.originalUrl.split('?')[0], body: req.rawBody ?? Buffer.alloc(0), secret: c.kiorlyWebhookSecret }) : { ok: false };
    if (!v.ok)
        throw new errors_1.ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
    const nonce = (0, node_crypto_1.createHash)('sha256').update(`${scope}|${one(req.headers['x-kiorly-nonce'])}`).digest('hex');
    try {
        await prisma.partnerIntakeNonce.create({ data: { id: nonce } });
    }
    catch {
        throw new errors_1.ApiError(401, 'PARTNER_UNAUTHORIZED', 'Request could not be authenticated');
    }
    const org = one(req.headers['x-kiorly-org-ref'])?.trim();
    if (!org || org.length > 64)
        throw new errors_1.ApiError(401, 'PARTNER_UNAUTHORIZED', 'X-Kiorly-Org-Ref is required');
    return org;
}
//# sourceMappingURL=partner-auth.js.map