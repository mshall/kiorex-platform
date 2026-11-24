import { ApiError } from '../common/errors';

/**
 * GRW-P2-X1: the Phase 2 module stubs answer every route they reserve with 404 FEATURE_DISABLED until the owning package ships. The stub body names the flag the real
 * endpoint will sit behind and the work package that fills the folder, so a caller (and a test) can tell "not built yet" from "switched off".
 */
export const notBuiltYet = (key: string, pkg: string) => new ApiError(404, 'FEATURE_DISABLED', `Not available yet (${pkg})`, { key, scope: 'global', pkg, stub: true });
