import { DEFAULT_MARKET } from '../../market/market-core-public';
import { Injectable } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { GrowthConfigService } from '../config/growth-config.service';
import { GROWTH_FLAG } from '../growth-flags';
import { JOURNEYS } from './journeys';
import type { JourneyDef, JourneyPolicy } from './journey.types';
import { stricterCaps, type Caps } from './frequency-cap';
import { defaultQuiet, type PolicyQuiet } from './quiet-hours';

export interface LifecyclePolicy {
  versionId: string; version: number; source: 'ACTIVE' | 'PROPOSED_DEFAULT';
  caps: Caps; quiet: PolicyQuiet; holdoutBps: number;
  journeys: Record<string, { enabled: boolean; maxSteps?: number }>;
}

/**
 * The LIFECYCLE_POLICY in force (maker-checker, two-person rule) read for one market, shaped for the runner. A journey that the policy does not mention is ON for its
 * non-marketing steps (the policy can only narrow, never widen what a class allows); the marketing steps still need the locked flag `growth.marketing_messaging`.
 */
@Injectable()
export class LifecyclePolicyService {
  constructor(private readonly config: GrowthConfigService, private readonly flags: FlagsService) {}

  async resolve(market = DEFAULT_MARKET): Promise<LifecyclePolicy> {
    const r = await this.config.resolve<Record<string, unknown>>('LIFECYCLE_POLICY', { market });
    const p = r.payload as { frequencyCaps?: { marketingPerDay?: number; marketingPerWeek?: number }; quietHours?: Partial<PolicyQuiet>; holdoutBps?: number; journeys?: Record<string, { enabled?: boolean; maxSteps?: number }> };
    // a PROPOSED_DEFAULT policy states no window of its own: the market's profile answers (so a new market never inherits another market's zone); an approved version may override it
    const dq = defaultQuiet(market); const q = r.source === 'PROPOSED_DEFAULT' ? {} : (p.quietHours ?? {});
    return {
      versionId: r.versionId, version: r.version, source: r.source,
      caps: { perDay: p.frequencyCaps?.marketingPerDay ?? 1, perWeek: p.frequencyCaps?.marketingPerWeek ?? 3 },
      quiet: { start: q.start ?? dq.start, end: q.end ?? dq.end, timezone: q.timezone ?? dq.timezone },
      holdoutBps: Math.max(0, Math.min(2000, p.holdoutBps ?? 0)),
      journeys: Object.fromEntries(Object.entries(p.journeys ?? {}).map(([k, v]) => [k, { enabled: v.enabled !== false, maxSteps: v.maxSteps }])),
    };
  }

  /** The caps that apply: the stricter of the lifecycle policy and the preference-centre defaults (a campaign and a journey share one budget). */
  capsFor(policy: LifecyclePolicy, centre: Caps): Caps { return stricterCaps(policy.caps, centre); }

  journeyPolicy(policy: LifecyclePolicy, def: JourneyDef): JourneyPolicy {
    const j = policy.journeys[def.key];
    return { enabled: j ? j.enabled : true, messageClass: def.steps[0]!.messageClass, maxSteps: j?.maxSteps };
  }

  /** `growth.lifecycle_journeys` for a market: OFF stops new enrolments and ends running ones with FLAG_OFF (messages of the notification layer are unaffected). */
  journeysOn(market = DEFAULT_MARKET): Promise<boolean> { return this.flags.isEnabled(GROWTH_FLAG.LIFECYCLE_JOURNEYS, { market }).catch(() => false); }
  marketingOn(market = DEFAULT_MARKET): Promise<boolean> { return this.flags.isEnabled(GROWTH_FLAG.MARKETING_MESSAGING, { market }).catch(() => false); }

  /** The journeys the code knows, for the console. */
  catalogue(): readonly JourneyDef[] { return JOURNEYS; }
}
