import { createHmac } from 'node:crypto';
import { growthKey } from '../../common/privacy-hash';
import { generateCode, normaliseCode } from '../corporate/corporate-code';

/**
 * Partnership codes (P4-D). Same Crockford alphabet and forgiving input as the other programme codes (shared pure helpers), but a hash under its OWN label, so a corporate or referral code can never match a
 * partnership code. Only the keyed hash is stored; the plain code is shown once to the ops user who creates it. No code is ever logged.
 */
export { generateCode as generatePartnershipCode, normaliseCode as normalisePartnershipCode };
export const hashPartnershipCode = (normalised: string): string => createHmac('sha256', growthKey('partnership-code')).update(normalised).digest('base64url');
/** Keyed hash of a person for the one-per-person rule and the erase function (never the Passport sub; one-way). */
export const loyaltyHashOf = (sub: string): string => createHmac('sha256', growthKey('partnership-person')).update(sub).digest('base64url');
