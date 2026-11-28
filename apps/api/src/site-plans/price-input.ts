import { badRequest } from '../common/errors';
import type { PriceInterval, PriceProduct } from './price-checks';

/** The body of a price preview or proposal (pure parsing, stable error codes). */
export interface PriceInput {
  product: PriceProduct;
  planRef: string;
  marketCode: string;
  interval: PriceInterval;
  unit: 'PER_TENANT' | 'PER_CLINICIAN';
  currency: string;
  amount: string;
  includedClinicians: number | null;
  extraClinicianAmount: string | null;
  validFrom: Date | null;
  note: string | null;
}

export const PRODUCTS: readonly PriceProduct[] = ['CLINIC', 'PHARMACY', 'LAB'];
export const PRODUCT_EDITIONS = ['LITE', 'PRO', 'CHAIN'] as const;
const MONEY = /^\d{1,12}(\.\d{1,2})?$/;
const ID = /^[A-Za-z0-9_-]{1,64}$/;

export function parsePriceInput(raw: unknown, now: Date = new Date()): PriceInput {
  const b = (raw && typeof raw === 'object' && !Array.isArray(raw) ? raw : {}) as Record<string, unknown>;
  const s = (v: unknown) => (typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : '');
  const product = s(b.product).toUpperCase() as PriceProduct;
  if (!PRODUCTS.includes(product)) throw badRequest('INVALID_PRODUCT', 'product must be CLINIC, PHARMACY or LAB');
  const planRef = s(b.planRef);
  if (product === 'CLINIC' ? !ID.test(planRef) : !(PRODUCT_EDITIONS as readonly string[]).includes(planRef.toUpperCase())) throw badRequest('INVALID_PLAN', product === 'CLINIC' ? 'Choose a Clinic plan' : 'edition must be LITE, PRO or CHAIN');
  const marketCode = s(b.marketCode).toUpperCase();
  if (!/^[A-Z]{2}$/.test(marketCode)) throw badRequest('INVALID_MARKET', 'marketCode must be a two-letter country code');
  const interval = s(b.interval).toUpperCase();
  if (interval !== 'MONTHLY' && interval !== 'ANNUAL') throw badRequest('INVALID_INTERVAL', 'interval must be MONTHLY or ANNUAL');
  const unit = s(b.unit).toUpperCase() || 'PER_TENANT';
  if (unit !== 'PER_TENANT' && unit !== 'PER_CLINICIAN') throw badRequest('INVALID_UNIT', 'unit must be PER_TENANT or PER_CLINICIAN');
  if (product !== 'CLINIC' && unit !== 'PER_TENANT') throw badRequest('INVALID_UNIT', 'Pharmacy and Lab prices are per organisation');
  const currency = s(b.currency).toUpperCase();
  if (!/^[A-Z]{3}$/.test(currency)) throw badRequest('INVALID_CURRENCY', 'currency must be a three-letter code');
  const amount = s(b.amount);
  if (!MONEY.test(amount)) throw badRequest('INVALID_AMOUNT', 'amount must be digits with at most two decimals');
  let includedClinicians: number | null = null;
  let extraClinicianAmount: string | null = null;
  if (product === 'CLINIC') {
    const inc = b.includedClinicians === undefined || b.includedClinicians === '' ? 1 : Number(b.includedClinicians);
    if (!Number.isInteger(inc) || inc < 1 || inc > 999) throw badRequest('INVALID_INCLUDED', 'includedClinicians must be a whole number of at least 1');
    includedClinicians = inc;
    const extra = s(b.extraClinicianAmount);
    if (extra) { if (!MONEY.test(extra)) throw badRequest('INVALID_EXTRA', 'extraClinicianAmount must be digits with at most two decimals'); extraClinicianAmount = extra; }
  }
  let validFrom: Date | null = null;
  if (b.validFrom !== undefined && b.validFrom !== null && b.validFrom !== '') {
    const d = new Date(s(b.validFrom));
    if (Number.isNaN(d.getTime())) throw badRequest('INVALID_VALID_FROM', 'validFrom is not a date');
    validFrom = d.getTime() < now.getTime() ? null : d; // a start in the past means "from the moment it is approved"
  }
  const note = s(b.note).slice(0, 300) || null;
  return { product, planRef: product === 'CLINIC' ? planRef : planRef.toUpperCase(), marketCode, interval: interval as PriceInterval, unit: unit as PriceInput['unit'], currency, amount, includedClinicians, extraClinicianAmount, validFrom, note };
}
