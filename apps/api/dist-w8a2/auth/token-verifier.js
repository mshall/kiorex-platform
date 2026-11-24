"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.JoseTokenVerifier = exports.TOKEN_VERIFIER = void 0;
const jose_1 = require("jose");
const config_1 = require("../common/config");
exports.TOKEN_VERIFIER = 'KX_TOKEN_VERIFIER';
class JoseTokenVerifier {
    keyResolver;
    jwks;
    constructor(keyResolver) {
        this.keyResolver = keyResolver;
    }
    keys() {
        if (this.keyResolver)
            return this.keyResolver;
        this.jwks ??= (0, jose_1.createRemoteJWKSet)(new URL(`${(0, config_1.cfg)().oidcIssuer.replace(/\/$/, '')}/jwks`), { cooldownDuration: 10_000 });
        return this.jwks;
    }
    async verifyAccess(token) {
        const { payload } = await (0, jose_1.jwtVerify)(token, this.keys(), { issuer: (0, config_1.cfg)().oidcIssuer, audience: (0, config_1.cfg)().oidcAudience, algorithms: ['RS256', 'ES256'] });
        return payload;
    }
    async verifyLogout(token) {
        const { payload } = await (0, jose_1.jwtVerify)(token, this.keys(), { issuer: (0, config_1.cfg)().oidcIssuer, algorithms: ['RS256', 'ES256'] });
        return payload;
    }
}
exports.JoseTokenVerifier = JoseTokenVerifier;
//# sourceMappingURL=token-verifier.js.map