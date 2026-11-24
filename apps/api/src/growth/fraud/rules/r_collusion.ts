import { referralRule } from './wrap';

/**
 * Provider collusion. Findings here are PROVIDER cases: they can only open a provider review that ops act on through the existing moderation. They never penalise a provider,
 * change a commission or block a booking. Legit case: a receptionist who books for patients with the clinic phone is a booking made on behalf, not collusion (excused for the phone match).
 */
export const rCollusion = referralRule('r_collusion', 'RF_PROVIDER_COLLUSION', 'PROVIDER', ['PROVIDER_REVIEW', 'REWARD'], (f, o) => (f.bookedOnBehalfByStaff && o.reason.startsWith('patient phone matches a staff phone') ? { ...o, strength: 0.2, reason: 'staff phone on a booking made on behalf of a patient' } : o));
