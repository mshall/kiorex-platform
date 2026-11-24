import { clamp01, type FraudRuleDef } from '../signals';

/**
 * Touch burst (the P1 touch rules wrapped as a signal; `fraud/touch-rules.ts` stays the recorder). A rotating ip hash that produces more touches per minute than a person,
 * or clicks on a provider-owned landing that was never rendered. Action on the TOUCH surface is a quarantine (excluded from reports), never an attribution decision change.
 */
export const rTouchBurst: FraudRuleDef = {
  id: 'r_touch_burst', kind: 'TOUCH', surfaces: ['TOUCH'],
  evaluate(f, t) {
    const limit = f.touchBurstLimit ?? t.touchBurstPerMinute;
    const burst = f.touchBurstPerMinute !== undefined && f.touchBurstPerMinute > limit;
    if (!burst && !f.clickWithoutRender) return null;
    const strength = burst ? clamp01(0.6 + ((f.touchBurstPerMinute! - limit) / (limit * 4))) : 0.5;
    return { strength, reason: burst ? 'more touches per minute than a person produces' : 'click without a rendered page', evidence: [burst ? 'burst-per-ip-hash' : 'click-without-render'] };
  },
};
