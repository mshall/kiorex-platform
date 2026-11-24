import { GROWTH_ERROR_STATUS, type GrowthErrorCode } from '@kiorex/contracts';
import { ApiError } from '../common/errors';

/** Growth surface errors: `code` and HTTP status come from @kiorex/contracts GROWTH_ERROR_CODES / GROWTH_ERROR_STATUS (one table for every product). */
export const growthError = (code: GrowthErrorCode, message: string, extra: Record<string, unknown> = {}) => new ApiError(GROWTH_ERROR_STATUS[code], code, message, extra);
