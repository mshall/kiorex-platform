import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { FlagsService } from '../../control-plane/control-plane-public';
import { DEFAULT_MARKET } from '../../market/market-core-public';
import { SEO_AUTOMATION_FLAG, type SeoTriggerPort } from './seo-automation-public';
import { SeoAutomationService } from './seo-automation.service';

export const SEO_TRIGGER_DEBOUNCE_MS = 60_000;

/**
 * Event triggers of the SEO quality gate (GRW-P3-F, wired in wave 9): a provider profile update, a listing publish or pause, and a slug change ask for a gate run.
 * Requests are coalesced per market (one run at most every minute, trailing), never block or fail the caller, and do nothing while `growth.seo_automation` is OFF.
 * A run only reports (and, with `SEO_AUTOMATION.autoNoindex` on, sets noindex): it never changes a page by itself.
 */
@Injectable()
export class SeoGateTriggerService implements SeoTriggerPort, OnModuleDestroy {
  private readonly log = new Logger('seo-trigger');
  private pending = new Map<string, { timer: NodeJS.Timeout; reasons: Set<string> }>();
  constructor(private readonly seo: SeoAutomationService, private readonly flags: FlagsService) {}

  request(reason: string, market: string = DEFAULT_MARKET): void {
    try {
      const have = this.pending.get(market);
      if (have) { have.reasons.add(reason); return; }
      const timer = setTimeout(() => void this.flush(market).catch(() => undefined), SEO_TRIGGER_DEBOUNCE_MS);
      timer.unref();
      this.pending.set(market, { timer, reasons: new Set([reason]) });
    } catch { /* a trigger never fails the caller */ }
  }
  pendingMarkets(): string[] { return [...this.pending.keys()]; }

  /** Runs the gate now for a market with a pending request (the timer calls it; tests call it directly). */
  async flush(market: string = DEFAULT_MARKET): Promise<{ ran: boolean; reasons: string[] }> {
    const p = this.pending.get(market); if (!p) return { ran: false, reasons: [] };
    clearTimeout(p.timer); this.pending.delete(market);
    const reasons = [...p.reasons];
    if (!(await this.flags.isEnabled(SEO_AUTOMATION_FLAG, { market }).catch(() => false))) return { ran: false, reasons };
    try { await this.seo.run({ market, actor: `system:seo-trigger:${reasons.join('+').slice(0, 80)}` }); return { ran: true, reasons }; }
    catch (e) { this.log.warn(`seo gate run failed (${(e as Error).message}); the nightly job repeats it`); return { ran: false, reasons }; }
  }
  onModuleDestroy() { for (const p of this.pending.values()) clearTimeout(p.timer); this.pending.clear(); }
}
