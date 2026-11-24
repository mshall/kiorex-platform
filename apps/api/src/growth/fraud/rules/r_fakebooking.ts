import { referralRule } from './wrap';

/** Fake booking: provider linked to the referrer, completion without a check-in, a very short visit, a deposit refunded after the reward, repeated cancel and rebook of one slot. */
export const rFakeBooking = referralRule('r_fakebooking', 'RF_FAKE_BOOKING', 'REFERRAL', ['REWARD']);
