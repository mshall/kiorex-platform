import { referralRule } from './wrap';

/** Bot sign-up: touch flagged as automated, a sign-up faster than a person, an OTP failure pattern. */
export const rBot = referralRule('r_bot', 'RF_BOT_SIGNUP', 'REFERRAL', ['REFERRAL_CLAIM']);
