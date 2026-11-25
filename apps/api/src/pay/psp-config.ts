import { decimalsOf } from '../common/providers/vendors/money';

/**
 * Payments configuration (PAY-READY). Everything an operator may change without a deploy, resolved in layers (later wins):
 *   code defaults  <  environment (PAYMENT_*, deployment-time)  <  PspSetting row (psp, market '*')  <  PspSetting row (psp, market CC).
 * NEVER holds a secret: secrets are env variables filled from Secrets Manager by reference (`/{product}/{env}/{purpose}`, see PSP_SECRETS); the config only names them.
 * Fees are CONFIG with no value shipped: `null` means NEEDS_HUMAN (finance, KX-12) and the system then books the fee the PSP reports, or 0 when it reports none. Nothing here invents a price.
 */
export type PspName = 'paymob' | 'fawry' | 'instapay' | 'card';
export const PSP_NAMES: PspName[] = ['paymob', 'fawry', 'instapay', 'card'];
export type PspMode = 'sandbox' | 'live';
export type ThreeDsMode = 'REQUIRED' | 'PREFERRED' | 'OFF';
export type CaptureMode = 'AUTO' | 'MANUAL';

export interface PspSettings {
  enabled: boolean;
  /** Order of preference inside a market: lowest first. The first enabled PSP that serves the market and currency wins. */
  order: number;
  /** Markets served; ['*'] = every market. */
  markets: string[];
  mode: PspMode;
  /** Currencies this PSP may charge; [] = the market currency only. */
  currencies: string[];
  /** Fractional digits of the minor unit when a currency is not in the built-in table (EGP = 2). */
  minorDecimals: number | null;
  fee: { percentBps: number | null; fixedMinor: number | null; vatBps: number | null };
  threeDsMode: ThreeDsMode;
  captureMode: CaptureMode;
  /** null = no PSP-imposed window configured (NEEDS_HUMAN: take the value from the merchant agreement). */
  refundWindowDays: number | null;
  partialRefunds: boolean;
  timeoutMs: number;
  maxRetries: number;
  /** Webhooks carrying a signed timestamp older than this are rejected (replay guard). 0 = off (vendors that sign no timestamp rely on event-id dedupe). */
  webhookToleranceSec: number;
  breaker: { threshold: number; cooldownMs: number };
  /** Status polling fallback: a payment still CREATED after this many minutes is asked about at the PSP; after giveUp it is failed locally. */
  pollAfterMinutes: number;
  pollGiveUpMinutes: number;
  /** Use a WEAK (derived, collision-prone) card fingerprint as a fraud signal. Default false. */
  acceptWeakFingerprint: boolean;
  /** How this PSP's settlement / report file is read (column names, units, kind words). null = the built-in header aliases (settlement-import.ts). */
  settlement: SettlementFormat | null;
}
export interface SettlementFormat {
  /** field -> the exact header (CSV) or key (JSON) in the vendor file: pspRef, amount, fee, kind, date, payoutRef, currency, status */
  columns: Partial<Record<'pspRef' | 'amount' | 'fee' | 'kind' | 'date' | 'payoutRef' | 'currency' | 'status', string>>;
  amountUnit: 'major' | 'minor';
  /** vendor word (lower case) -> our kind */
  kindMap: Record<string, 'CAPTURE' | 'REFUND' | 'CHARGEBACK' | 'PAYOUT' | 'FEE_ADJUST'>;
  /** statuses (lower case) that are not money movement and are skipped */
  skipStatuses: string[];
}

export const PSP_DEFAULTS: PspSettings = {
  enabled: false, order: 100, markets: ['*'], mode: 'sandbox', currencies: [], minorDecimals: null,
  fee: { percentBps: null, fixedMinor: null, vatBps: null },
  threeDsMode: 'REQUIRED', captureMode: 'AUTO', refundWindowDays: null, partialRefunds: true,
  timeoutMs: 8000, maxRetries: 2, webhookToleranceSec: 300,
  breaker: { threshold: 5, cooldownMs: 60_000 },
  pollAfterMinutes: 10, pollGiveUpMinutes: 24 * 60, acceptWeakFingerprint: false, settlement: null,
};

/** What each PSP can do; the settings are clamped to it (a PSP without authorize/capture is forced to AUTO). */
export const PSP_CAPS: Record<PspName, { capture: boolean; partialRefund: boolean; threeDs: boolean }> = {
  paymob: { capture: true, partialRefund: true, threeDs: true },
  fawry: { capture: false, partialRefund: true, threeDs: false },
  instapay: { capture: false, partialRefund: true, threeDs: false },
  card: { capture: true, partialRefund: true, threeDs: true },
};

/** Secrets by REFERENCE. `ref` is the Secrets Manager path (`/{product}/{env}/{purpose}`), `env` the variable the platform fills from it; the value is never read here, logged or returned. */
export interface PspSecretSpec { psp: PspName | 'all'; purpose: string; env: string; kind: 'api-key' | 'public-key' | 'hmac' | 'merchant-id' | 'integration-ids' | 'url' | 'pepper' }
export const PSP_SECRETS: readonly PspSecretSpec[] = [
  { psp: 'paymob', purpose: 'paymob-secret-key', env: 'PAYMOB_SECRET_KEY', kind: 'api-key' },
  { psp: 'paymob', purpose: 'paymob-public-key', env: 'PAYMOB_PUBLIC_KEY', kind: 'public-key' },
  { psp: 'paymob', purpose: 'paymob-hmac-secret', env: 'PAYMOB_HMAC_SECRET', kind: 'hmac' },
  { psp: 'paymob', purpose: 'paymob-integration-ids', env: 'PAYMOB_INTEGRATION_IDS', kind: 'integration-ids' },
  { psp: 'fawry', purpose: 'fawry-merchant-code', env: 'FAWRY_MERCHANT_CODE', kind: 'merchant-id' },
  { psp: 'fawry', purpose: 'fawry-secure-key', env: 'FAWRY_SECURE_KEY', kind: 'hmac' },
  { psp: 'instapay', purpose: 'instapay-api-key', env: 'INSTAPAY_API_KEY', kind: 'api-key' },
  { psp: 'instapay', purpose: 'instapay-webhook-secret', env: 'INSTAPAY_WEBHOOK_SECRET', kind: 'hmac' },
  { psp: 'card', purpose: 'cardgw-api-key', env: 'CARDGW_API_KEY', kind: 'api-key' },
  { psp: 'card', purpose: 'cardgw-webhook-secret', env: 'CARDGW_WEBHOOK_SECRET', kind: 'hmac' },
  { psp: 'all', purpose: 'payment-fingerprint-pepper', env: 'PAYMENT_FINGERPRINT_PEPPER', kind: 'pepper' },
];
export const secretRef = (product: string, env: string, purpose: string) => `/${product}/${env}/${purpose}`;
export const SECRET_REF_PATTERN = /^\/[a-z0-9-]+\/[a-z0-9-]+\/[a-z0-9-]+$/;

const num = (v: unknown, d: number, min = 0, max = Number.MAX_SAFE_INTEGER): number => { const n = typeof v === 'string' && v.trim() ? Number(v) : v; return typeof n === 'number' && Number.isFinite(n) && n >= min && n <= max ? Math.floor(n) : d; };
const optNum = (v: unknown, d: number | null, min = 0, max = 1_000_000_000): number | null => (v === null ? null : v === undefined || v === '' ? d : typeof Number(v) === 'number' && Number.isFinite(Number(v)) && Number(v) >= min && Number(v) <= max ? Math.floor(Number(v)) : d);
const oneOf = <T extends string>(v: unknown, all: readonly T[], d: T): T => (typeof v === 'string' && (all as readonly string[]).includes(v) ? (v as T) : d);
const strList = (v: unknown, d: string[]): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string' && !!x.trim()).map((s) => s.trim()) : typeof v === 'string' && v.trim() ? v.split(',').map((s) => s.trim()).filter(Boolean) : d);

const KINDS = ['CAPTURE', 'REFUND', 'CHARGEBACK', 'PAYOUT', 'FEE_ADJUST'] as const;
const COLS = ['pspRef', 'amount', 'fee', 'kind', 'date', 'payoutRef', 'currency', 'status'] as const;
function settlementOf(v: unknown, base: SettlementFormat | null): SettlementFormat | null {
  if (v === null) return null;
  if (!v || typeof v !== 'object') return base;
  const o = v as Record<string, any>;
  const columns: SettlementFormat['columns'] = { ...(base?.columns ?? {}) };
  for (const c of COLS) if (typeof o.columns?.[c] === 'string' && o.columns[c].trim() && o.columns[c].length <= 80) columns[c] = o.columns[c].trim();
  const kindMap: SettlementFormat['kindMap'] = { ...(base?.kindMap ?? {}) };
  if (o.kindMap && typeof o.kindMap === 'object') for (const [k, val] of Object.entries(o.kindMap)) if ((KINDS as readonly string[]).includes(String(val)) && k.length <= 60) kindMap[k.toLowerCase()] = val as SettlementFormat['kindMap'][string];
  return { columns, amountUnit: o.amountUnit === 'minor' ? 'minor' : o.amountUnit === 'major' ? 'major' : base?.amountUnit ?? 'major', kindMap, skipStatuses: Array.isArray(o.skipStatuses) ? o.skipStatuses.filter((x: unknown): x is string => typeof x === 'string').map((x) => x.toLowerCase()).slice(0, 20) : base?.skipStatuses ?? [] };
}

/** Merge one layer (untrusted: env strings or a JSON row) over a base. Unknown or out-of-range values are ignored (the base stays), so a bad row can never produce an unsafe config. */
export function mergeSettings(base: PspSettings, layer: Record<string, any> | null | undefined, psp?: PspName): PspSettings {
  const l = layer ?? {};
  const f = (l.fee && typeof l.fee === 'object' ? l.fee : {}) as Record<string, unknown>;
  const b = (l.breaker && typeof l.breaker === 'object' ? l.breaker : {}) as Record<string, unknown>;
  const caps = psp ? PSP_CAPS[psp] : { capture: true, partialRefund: true, threeDs: true };
  const out: PspSettings = {
    enabled: typeof l.enabled === 'boolean' ? l.enabled : base.enabled,
    order: num(l.order, base.order, 0, 10_000),
    markets: strList(l.markets, base.markets).map((m) => (m === '*' ? m : m.toUpperCase())),
    mode: oneOf(l.mode, ['sandbox', 'live'] as const, base.mode),
    currencies: strList(l.currencies, base.currencies).map((c) => c.toUpperCase()),
    minorDecimals: optNum(l.minorDecimals, base.minorDecimals, 0, 4),
    fee: { percentBps: optNum(f.percentBps, base.fee.percentBps, 0, 10_000), fixedMinor: optNum(f.fixedMinor, base.fee.fixedMinor, 0, 1_000_000), vatBps: optNum(f.vatBps, base.fee.vatBps, 0, 10_000) },
    threeDsMode: oneOf(l.threeDsMode, ['REQUIRED', 'PREFERRED', 'OFF'] as const, base.threeDsMode),
    captureMode: oneOf(l.captureMode, ['AUTO', 'MANUAL'] as const, base.captureMode),
    refundWindowDays: optNum(l.refundWindowDays, base.refundWindowDays, 0, 3650),
    partialRefunds: typeof l.partialRefunds === 'boolean' ? l.partialRefunds : base.partialRefunds,
    timeoutMs: num(l.timeoutMs, base.timeoutMs, 500, 60_000),
    maxRetries: num(l.maxRetries, base.maxRetries, 0, 6),
    webhookToleranceSec: num(l.webhookToleranceSec, base.webhookToleranceSec, 0, 86_400),
    breaker: { threshold: num(b.threshold, base.breaker.threshold, 1, 100), cooldownMs: num(b.cooldownMs, base.breaker.cooldownMs, 1000, 3_600_000) },
    pollAfterMinutes: num(l.pollAfterMinutes, base.pollAfterMinutes, 1, 1440),
    pollGiveUpMinutes: num(l.pollGiveUpMinutes, base.pollGiveUpMinutes, 5, 10_080),
    acceptWeakFingerprint: typeof l.acceptWeakFingerprint === 'boolean' ? l.acceptWeakFingerprint : base.acceptWeakFingerprint,
    settlement: settlementOf(l.settlement, base.settlement),
  };
  if (!caps.capture) out.captureMode = 'AUTO';
  if (!caps.partialRefund) out.partialRefunds = false;
  if (!caps.threeDs && out.threeDsMode === 'REQUIRED') out.threeDsMode = 'OFF'; // the PSP has no card step: the setting cannot apply (not an error)
  if (out.pollGiveUpMinutes <= out.pollAfterMinutes) out.pollGiveUpMinutes = out.pollAfterMinutes * 2;
  return out;
}

type Env = Record<string, string | undefined>;
/** Environment layer: PAYMENT_ENVIRONMENT (sandbox|live, one switch for every PSP), PAYMENT_ENABLED_PSPS (comma order = preference), PAYMENT_<KEY> globals, PAYMENT_<PSP>_<KEY> per PSP. Names only; no secrets. */
export function envLayer(psp: PspName, env: Env = process.env): Record<string, unknown> {
  const P = psp.toUpperCase();
  const pick = (k: string) => env[`PAYMENT_${P}_${k}`] ?? env[`PAYMENT_${k}`];
  const enabled = (env.PAYMENT_ENABLED_PSPS ?? 'paymob').split(',').map((s) => s.trim().toLowerCase()).filter(Boolean);
  const idx = enabled.indexOf(psp);
  const layer: Record<string, unknown> = { enabled: idx >= 0, order: idx >= 0 ? (idx + 1) * 10 : 100 };
  const environment = (env.PAYMENT_ENVIRONMENT ?? '').trim().toLowerCase();
  if (environment === 'live' || environment === 'sandbox') layer.mode = environment;
  for (const [k, e] of [['threeDsMode', 'THREEDS_MODE'], ['captureMode', 'CAPTURE_MODE'], ['refundWindowDays', 'REFUND_WINDOW_DAYS'], ['timeoutMs', 'TIMEOUT_MS'], ['maxRetries', 'MAX_RETRIES'], ['webhookToleranceSec', 'WEBHOOK_TOLERANCE_SEC'], ['markets', 'MARKETS'], ['currencies', 'CURRENCIES'], ['minorDecimals', 'MINOR_DECIMALS']] as const) { const v = pick(e); if (v !== undefined && v !== '') layer[k] = k === 'threeDsMode' || k === 'captureMode' ? v.toUpperCase() : v; }
  const fee: Record<string, unknown> = {};
  for (const [k, e] of [['percentBps', 'FEE_BPS'], ['fixedMinor', 'FEE_FIXED_MINOR'], ['vatBps', 'FEE_VAT_BPS']] as const) { const v = pick(e); if (v !== undefined && v !== '') fee[k] = v; }
  if (!fee.percentBps && psp === 'paymob' && env.PSP_FEE_BPS && Number(env.PSP_FEE_BPS) > 0) fee.percentBps = env.PSP_FEE_BPS; // legacy single-rate variable
  if (Object.keys(fee).length) layer.fee = fee;
  return layer;
}

/** The resolved settings of one PSP in one market from the env and the DB rows (`rows`: [{market, settings}], '*' first). */
export function resolveSettings(psp: PspName, market: string, rows: Array<{ market: string; settings: unknown }> = [], env: Env = process.env): PspSettings {
  let s = mergeSettings(PSP_DEFAULTS, envLayer(psp, env), psp);
  const star = rows.find((r) => r.market === '*'); const own = rows.find((r) => r.market === market.toUpperCase());
  if (star) s = mergeSettings(s, star.settings as Record<string, unknown>, psp);
  if (own) s = mergeSettings(s, own.settings as Record<string, unknown>, psp);
  return s;
}

export const servesMarket = (s: PspSettings, market: string, currency: string, marketCurrency?: string): boolean =>
  s.enabled && (s.markets.includes('*') || s.markets.includes(market.toUpperCase())) && (s.currencies.length ? s.currencies.includes(currency.toUpperCase()) : !marketCurrency || marketCurrency.toUpperCase() === currency.toUpperCase());

/** Enabled PSPs for a market in order of preference (lowest `order` first, then name). */
export function pspsForMarket(all: Record<PspName, PspSettings>, market: string, currency: string, marketCurrency?: string): PspName[] {
  return PSP_NAMES.filter((n) => servesMarket(all[n], market, currency, marketCurrency)).sort((a, b) => all[a].order - all[b].order || a.localeCompare(b));
}

/** Fee to book for one capture. The PSP-reported fee wins; else the configured rate (percent of the CARD amount rounded half up + fixed); null configured = 0 and `needsHuman` is true. VAT on the fee is shown on statements, never added here. */
export function feeFor(s: PspSettings, amountMinor: number, reportedMinor?: number): { feeMinor: number; source: 'PSP_REPORTED' | 'CONFIG' | 'UNSET'; needsHuman: boolean } {
  if (reportedMinor !== undefined && Number.isInteger(reportedMinor) && reportedMinor >= 0) return { feeMinor: reportedMinor, source: 'PSP_REPORTED', needsHuman: false };
  if (s.fee.percentBps === null && s.fee.fixedMinor === null) return { feeMinor: 0, source: 'UNSET', needsHuman: true };
  return { feeMinor: Math.min(amountMinor, Math.round(((s.fee.percentBps ?? 0) * amountMinor) / 10_000) + (s.fee.fixedMinor ?? 0)), source: 'CONFIG', needsHuman: false };
}

/** Is a refund still inside the PSP's refund window? null window = no limit configured. */
export function withinRefundWindow(s: PspSettings, capturedAt: Date | null, now = new Date()): boolean {
  if (s.refundWindowDays === null || !capturedAt) return true;
  return now.getTime() - capturedAt.getTime() <= s.refundWindowDays * 86_400_000;
}

export const minorDigits = (s: PspSettings, currency: string) => decimalsOf(currency, s.minorDecimals ?? undefined);

/** Problems with a settings document before it is saved (names and reasons only). */
export function settingsProblems(psp: PspName, s: PspSettings, env: Env = process.env): string[] {
  const out: string[] = [];
  if (s.mode === 'live' && env.NODE_ENV !== 'production' && env.PAYMENT_ALLOW_LIVE !== 'true') out.push('mode=live outside production needs PAYMENT_ALLOW_LIVE=true (a deliberate acknowledgement)');
  if (s.enabled && s.fee.percentBps === null && s.fee.fixedMinor === null) out.push(`fee for ${psp} is not configured (NEEDS_HUMAN: finance); the PSP-reported fee is booked, otherwise 0`);
  if (s.enabled && s.refundWindowDays === null) out.push(`refundWindowDays for ${psp} is not configured (NEEDS_HUMAN: merchant agreement); refunds are not limited by time`);
  if (s.threeDsMode === 'OFF' && PSP_CAPS[psp].threeDs && s.mode === 'live') out.push('3DS OFF in live mode shifts chargeback liability to the merchant');
  return out;
}

/** Key-mode mismatch guard: a vendor test key in live mode (or a live key in sandbox) is refused. Only the PUBLIC prefix pattern is inspected (Paymob egy_sk_test_ / egy_sk_live_); the value is never returned. */
export function keyModeProblem(psp: PspName, mode: PspMode, env: Env = process.env): string | null {
  if (psp !== 'paymob') return null;
  const k = env.PAYMOB_SECRET_KEY ?? '';
  if (!k) return null;
  const isTest = /_test_/.test(k); const isLive = /_live_/.test(k);
  if (mode === 'live' && isTest) return 'PAYMOB_SECRET_KEY looks like a TEST key but PAYMENT_ENVIRONMENT=live';
  if (mode === 'sandbox' && isLive) return 'PAYMOB_SECRET_KEY looks like a LIVE key but PAYMENT_ENVIRONMENT=sandbox';
  return null;
}
