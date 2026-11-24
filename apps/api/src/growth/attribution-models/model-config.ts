import { DEFAULT_DATA_DRIVEN, type DataDrivenConfig } from './data-driven';
import { DEFAULT_MODEL_OPTIONS, type ModelOptions } from './models';
import { checkWindows, DEFAULT_WINDOWS, type ModelWindows } from './windows';

/**
 * Settings of the reporting models (config kind `ATTRIBUTION_MODELS`, planned in contracts 1.13.0). Until that kind is published they are the PROPOSED_DEFAULT below, and a
 * resolved payload is validated here before use. A reporting window never changes `ATTRIBUTION_POLICY`: the money decision does not read this file.
 */
export interface AttributionModelsConfig { windows: ModelWindows; options: ModelOptions; dataDriven: DataDrivenConfig }
export const DEFAULT_MODELS_CONFIG: AttributionModelsConfig = { windows: DEFAULT_WINDOWS, options: DEFAULT_MODEL_OPTIONS, dataDriven: DEFAULT_DATA_DRIVEN };

/** Merges an operator payload over the defaults and validates it (windows 1..90 days, first plus last position share at most 100 percent, thresholds positive). */
export function resolveModelsConfig(p?: Partial<{ windows: Partial<ModelWindows>; halfLifeDays: number; positionFirstBp: number; positionLastBp: number; dataDriven: Partial<DataDrivenConfig> }>): AttributionModelsConfig {
  const windows = checkWindows({ ...DEFAULT_WINDOWS, ...(p?.windows ?? {}) });
  const options: ModelOptions = { halfLifeDays: p?.halfLifeDays ?? DEFAULT_MODEL_OPTIONS.halfLifeDays, positionFirstBp: p?.positionFirstBp ?? DEFAULT_MODEL_OPTIONS.positionFirstBp, positionLastBp: p?.positionLastBp ?? DEFAULT_MODEL_OPTIONS.positionLastBp };
  if (!(options.halfLifeDays > 0 && options.halfLifeDays <= 90)) throw new RangeError('halfLifeDays must be in (0, 90]');
  if (options.positionFirstBp < 0 || options.positionLastBp < 0 || options.positionFirstBp + options.positionLastBp > 10_000) throw new RangeError('position shares must be non-negative and add up to at most 10000 bp');
  const dataDriven = { ...DEFAULT_DATA_DRIVEN, ...(p?.dataDriven ?? {}) };
  if (!(dataDriven.minConversions >= 100) || !(dataDriven.minNodeK >= 10)) throw new RangeError('data-driven needs at least 100 conversions and a node k of at least 10');
  return { windows, options, dataDriven };
}
