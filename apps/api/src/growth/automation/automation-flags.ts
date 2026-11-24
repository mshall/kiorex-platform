/**
 * Flag keys of the wave 8 growth packages. Contracts 1.13.0 (the release that registers them in the catalogue) is not published yet, so until it is an unregistered key evaluates ON
 * in the flag service (UNKNOWN_FLAG). That is safe for automation (every MARKETING send still needs the locked `growth.marketing_messaging`), and it is NOT safe for the AI summary, so
 * the recommendation service fails CLOSED on an unregistered `growth.ai_recommendations`: only a registered, effective flag with its gate evidence opens the real model.
 */
export const AUTOMATION_FLAG = 'growth.automation_journeys';
export const AI_RECOMMENDATIONS_FLAG = 'growth.ai_recommendations';
