import { createRemoteJWKSet, jwtVerify, JWTPayload, JWTVerifyGetKey } from 'jose';
import { cfg } from '../common/config';

export const TOKEN_VERIFIER = 'KX_TOKEN_VERIFIER';

export interface TokenVerifier {
  verifyAccess(token: string): Promise<JWTPayload>;
  verifyLogout(token: string): Promise<JWTPayload>;
}

/** Verifies Kiorex Passport JWTs (RS256) against the issuer JWKS (KX-04, KA04). */
export class JoseTokenVerifier implements TokenVerifier {
  private jwks?: JWTVerifyGetKey;
  constructor(private readonly keyResolver?: JWTVerifyGetKey) {}
  private keys(): JWTVerifyGetKey {
    if (this.keyResolver) return this.keyResolver;
    this.jwks ??= createRemoteJWKSet(new URL(`${cfg().oidcIssuer.replace(/\/$/, '')}/jwks`), { cooldownDuration: 10_000 });
    return this.jwks;
  }
  async verifyAccess(token: string) {
    const { payload } = await jwtVerify(token, this.keys(), { issuer: cfg().oidcIssuer, audience: cfg().oidcAudience, algorithms: ['RS256', 'ES256'] });
    return payload;
  }
  async verifyLogout(token: string) {
    const { payload } = await jwtVerify(token, this.keys(), { issuer: cfg().oidcIssuer, algorithms: ['RS256', 'ES256'] });
    return payload;
  }
}
