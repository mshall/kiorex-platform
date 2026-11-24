import { referralRule } from './wrap';

/** Cancellation abuse: cancelled or refunded inside the hold window, cancelled after the reward, a no-show then a qualifying rebook. */
export const rCancel = referralRule('r_cancel', 'RF_CANCEL_ABUSE', 'REWARD', ['REWARD', 'REFERRAL_ELIGIBILITY']);
