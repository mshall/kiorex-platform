import type { JourneyDef } from '../journey.types';
import { BOOKING_RECOVERY_JOURNEY } from './booking-recovery.journey';
import { FAMILY_ONBOARDING_JOURNEY } from './family-onboarding.journey';
import { POST_VISIT_JOURNEY } from './post-visit.journey';
import { REENGAGEMENT_JOURNEY } from './reengagement.journey';
import { REFERRAL_INVITE_JOURNEY } from './referral-invite.journey';
import { REMINDERS_JOURNEY } from './reminders.journey';
import { REWARD_NOTICE_JOURNEY } from './reward-notice.journey';
import { WELCOME_JOURNEY } from './welcome.journey';

/** The eight lifecycle journeys. Code-defined; the policy only switches them on or off and limits steps. */
export const JOURNEYS: readonly JourneyDef[] = [WELCOME_JOURNEY, BOOKING_RECOVERY_JOURNEY, REMINDERS_JOURNEY, POST_VISIT_JOURNEY, REENGAGEMENT_JOURNEY, REFERRAL_INVITE_JOURNEY, REWARD_NOTICE_JOURNEY, FAMILY_ONBOARDING_JOURNEY];
export const journeyByKey = (key: string) => JOURNEYS.find((j) => j.key === key);
export { BOOKING_RECOVERY_JOURNEY, FAMILY_ONBOARDING_JOURNEY, POST_VISIT_JOURNEY, REENGAGEMENT_JOURNEY, REFERRAL_INVITE_JOURNEY, REMINDERS_JOURNEY, REWARD_NOTICE_JOURNEY, WELCOME_JOURNEY };
