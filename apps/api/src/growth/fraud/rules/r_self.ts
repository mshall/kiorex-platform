import { referralRule } from './wrap';

/**
 * Self-referral. Legit family: a declared household that shares one phone (a parent and a child on one number) is not the same person; a phone-only match inside a declared
 * household is weak evidence (strength 0.25, below the review band). A shared account, email, payment fingerprint or device is never excused.
 */
export const rSelf = referralRule('r_self', 'RF_SELF', 'REFERRAL', ['REFERRAL_CLAIM', 'REFERRAL_ELIGIBILITY', 'REWARD'], (f, o) => {
  const phoneOnly = o.reason === 'same phone';
  return f.householdDeclared && phoneOnly ? { ...o, strength: 0.25, reason: 'same phone inside a declared household' } : o;
});
