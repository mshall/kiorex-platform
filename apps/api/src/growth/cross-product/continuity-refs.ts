import { createHmac } from 'node:crypto';
import { growthKey } from '../../common/privacy-hash';

/**
 * Keyed hash of a fact id for the continuity tables (32 hex characters). The key is derived from FIELD_ENCRYPTION_KEY with the label of this package, so a hash cannot be matched against
 * any other growth table, and without the key a Kiorex id cannot be recomputed from a row. The same id always gives the same hash (idempotency, joins inside this package).
 */
export const factRef = (kind: 'CLINIC_BOOKING' | 'RX' | 'LAB_ORDER' | 'PHARMACY_ORDER' | 'LAB_BOOKING' | 'CARE_PLAN', id: string): string =>
  createHmac('sha256', growthKey('cross-product:fact')).update(`${kind}:${id}`).digest('hex').slice(0, 32);
