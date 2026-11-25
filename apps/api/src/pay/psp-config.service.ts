import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { badRequest } from '../common/errors';
import { MARKET_FACTS } from '../market/market-public';
import { PrismaService } from '../prisma/prisma.service';
import { keyModeProblem, mergeSettings, PSP_NAMES, pspsForMarket, resolveSettings, settingsProblems, type PspName, type PspSettings } from './psp-config';
import { enabledPsps, PSP_VENDOR_MODE } from './psp.vendors';

type Row = { psp: string; market: string; settings: unknown };
const TTL_MS = 15_000;

/** The market a currency belongs to (first market in the registry using it); EG by default. */
export const marketOfCurrency = (currency: string): string => Object.entries(MARKET_FACTS).find(([, f]) => f.currency === currency.toUpperCase())?.[0] ?? 'EG';

/**
 * Payments settings: env layer + PspSetting rows (psp, market), cached for a few seconds so a console change takes effect without a deploy and without a query per payment.
 * The PSP is CHOSEN here (enabled PSPs of the market in order of preference); in mock mode the requested name wins and every PSP is available (exactly as before PAY-READY).
 */
@Injectable()
export class PspConfigService {
  private cache: { at: number; rows: Row[] } | null = null;
  constructor(private readonly prisma: PrismaService) {}

  private async rows(): Promise<Row[]> {
    if (this.cache && Date.now() - this.cache.at < TTL_MS) return this.cache.rows;
    const rows = await this.prisma.pspSetting.findMany();
    this.cache = { at: Date.now(), rows };
    return rows;
  }
  invalidate() { this.cache = null; }

  async settingsFor(psp: PspName, market = '*'): Promise<PspSettings> {
    const rows = (await this.rows()).filter((r) => r.psp === psp);
    return resolveSettings(psp, market, rows);
  }
  async all(market = 'EG'): Promise<Record<PspName, PspSettings>> {
    const out = {} as Record<PspName, PspSettings>;
    for (const n of PSP_NAMES) out[n] = await this.settingsFor(n, market);
    return out;
  }

  /** The PSP for a new payment. Vendor / gateway mode: the requested PSP when enabled for the market and currency, else the best-ranked enabled one. Mock mode: the requested one (default paymob). */
  async choose(i: { currency: string; requested?: string; market?: string }): Promise<{ psp: PspName; settings: PspSettings }> {
    const market = i.market ?? marketOfCurrency(i.currency);
    const req = (PSP_NAMES.includes(i.requested as PspName) ? i.requested : undefined) as PspName | undefined;
    if (cfg().pspMode === 'sandbox-fake') { const psp = req ?? 'paymob'; return { psp, settings: await this.settingsFor(psp, market) }; }
    const all = await this.all(market);
    const mc = MARKET_FACTS[market]?.currency;
    // vendor mode: the env list is authoritative for what is installed (credentials exist only for those); the rows tune them
    const installed = PSP_VENDOR_MODE() ? new Set<string>(enabledPsps()) : null;
    const eligible = pspsForMarket(all, market, i.currency, mc).filter((n) => !installed || installed.has(n));
    const psp = req && eligible.includes(req) ? req : eligible[0];
    if (!psp) throw badRequest('PSP_NOT_AVAILABLE', 'No payment provider is enabled for this market and currency');
    return { psp, settings: all[psp] };
  }

  /**
   * Routing: every PSP that may take this payment, best first. Order of preference by default; with PAYMENT_ROUTING=cost the PSPs whose fee is CONFIGURED are ranked by their configured
   * percentage (cheapest first, a PSP without a configured fee keeps its place by order and is never assumed cheap: fees are NEEDS_HUMAN, never invented). The requested PSP leads when it
   * is eligible. The caller walks the list when a PSP's circuit is open (failover).
   */
  async candidates(i: { currency: string; requested?: string; market?: string }): Promise<Array<{ psp: PspName; settings: PspSettings }>> {
    const market = i.market ?? marketOfCurrency(i.currency);
    if (cfg().pspMode === 'sandbox-fake') { const one = await this.choose(i); return [one]; }
    const all = await this.all(market); const mc = MARKET_FACTS[market]?.currency;
    const installed = PSP_VENDOR_MODE() ? new Set<string>(enabledPsps()) : null;
    let list = pspsForMarket(all, market, i.currency, mc).filter((n) => !installed || installed.has(n));
    if ((process.env.PAYMENT_ROUTING ?? 'order') === 'cost') list = [...list].sort((a, b) => { const fa = all[a].fee.percentBps, fb = all[b].fee.percentBps; return fa !== null && fb !== null && fa !== fb ? fa - fb : all[a].order - all[b].order; });
    const req = i.requested as PspName | undefined;
    if (req && list.includes(req)) list = [req, ...list.filter((n) => n !== req)];
    if (!list.length) throw badRequest('PSP_NOT_AVAILABLE', 'No payment provider is enabled for this market and currency');
    return list.map((psp) => ({ psp, settings: all[psp] }));
  }

  /** What the ops console shows: every PSP with its resolved settings, the problems with them (names only) and where each value comes from. Secrets never appear. */
  async view(market = 'EG') {
    const all = await this.all(market);
    return PSP_NAMES.map((psp) => ({ psp, settings: all[psp], problems: [...settingsProblems(psp, all[psp]), ...(keyModeProblem(psp, all[psp].mode) ? [keyModeProblem(psp, all[psp].mode)!] : [])] }));
  }

  /** Save a settings patch for (psp, market). The patch is merged onto the CURRENT resolved settings (unknown / out-of-range values are dropped), versioned, and audited with the actor and the changed keys only. */
  async update(psp: string, market: string, patch: Record<string, unknown>, actor: string) {
    if (!PSP_NAMES.includes(psp as PspName)) throw badRequest('UNKNOWN_PSP', 'Unknown payment provider');
    if (!/^(\*|[A-Za-z]{2})$/.test(market)) throw badRequest('INVALID_MARKET', 'market must be * or a two-letter code');
    if (JSON.stringify(patch).match(/secret|token|apikey|password|hmac/i)) throw badRequest('SECRETS_NOT_STORED', 'Secrets are never stored in settings: they are referenced by name (see the connection check)');
    const m = market === '*' ? '*' : market.toUpperCase();
    const before = (await this.prisma.pspSetting.findUnique({ where: { psp_market: { psp, market: m } } }))?.settings as Record<string, unknown> | undefined;
    const merged = mergeSettings(resolveSettings(psp as PspName, m, (await this.prisma.pspSetting.findMany({ where: { psp } }))), patch, psp as PspName);
    const problems = settingsProblems(psp as PspName, merged).filter((p) => /outside production/.test(p));
    if (problems.length) throw badRequest('SETTINGS_REJECTED', problems.join('; '));
    const doc = { ...(before ?? {}), ...patch } as Record<string, unknown>;
    const saved = await this.prisma.$transaction(async (tx) => {
      const row = await tx.pspSetting.upsert({ where: { psp_market: { psp, market: m } }, create: { psp, market: m, settings: doc as never, updatedBy: actor }, update: { settings: doc as never, version: { increment: 1 }, updatedBy: actor } });
      await tx.auditLog.create({ data: { actor, action: 'pay.settings_changed', resource: 'PspSetting', resourceId: `${psp}:${m}`, metadata: { keys: Object.keys(patch), version: row.version } as never } });
      return row;
    });
    this.invalidate();
    return { psp, market: m, version: saved.version, settings: merged };
  }
}
