import { referralRule } from './wrap';

/** Redemption abuse: a code used by another account, many redemptions on bookings later cancelled, redeeming across accounts that share a fingerprint. */
export const rRedeem = referralRule('r_redeem', 'RF_REDEEM_ABUSE', 'REWARD', ['REWARD']);
