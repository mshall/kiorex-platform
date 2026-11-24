import { referralRule } from './wrap';

/** Duplicate account: the referee's phone is on another account, linked accounts, or many sign-ups from one network prefix. A declared household is excused for the phone check. */
export const rDup = referralRule('r_dup', 'RF_DUP_ACCOUNT', 'REFERRAL', ['REFERRAL_CLAIM', 'REWARD'], (f, o) => (f.householdDeclared && o.reason === 'phone seen on another account' ? { ...o, strength: 0.25, reason: 'phone shared inside a declared household' } : o));
