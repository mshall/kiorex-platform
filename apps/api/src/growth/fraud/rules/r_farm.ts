import { referralRule } from './wrap';

/** Referral farming: referrer velocity, many referees with one provider, first bookings within minutes, shared payment fingerprint, referees that never book twice. */
export const rFarm = referralRule('r_farm', 'RF_FARM', 'REFERRAL', ['REWARD', 'REFERRAL_ELIGIBILITY']);
