"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.DEFAULT_MODELS_CONFIG = void 0;
exports.resolveModelsConfig = resolveModelsConfig;
const data_driven_1 = require("./data-driven");
const models_1 = require("./models");
const windows_1 = require("./windows");
exports.DEFAULT_MODELS_CONFIG = { windows: windows_1.DEFAULT_WINDOWS, options: models_1.DEFAULT_MODEL_OPTIONS, dataDriven: data_driven_1.DEFAULT_DATA_DRIVEN };
function resolveModelsConfig(p) {
    const windows = (0, windows_1.checkWindows)({ ...windows_1.DEFAULT_WINDOWS, ...(p?.windows ?? {}) });
    const options = { halfLifeDays: p?.halfLifeDays ?? models_1.DEFAULT_MODEL_OPTIONS.halfLifeDays, positionFirstBp: p?.positionFirstBp ?? models_1.DEFAULT_MODEL_OPTIONS.positionFirstBp, positionLastBp: p?.positionLastBp ?? models_1.DEFAULT_MODEL_OPTIONS.positionLastBp };
    if (!(options.halfLifeDays > 0 && options.halfLifeDays <= 90))
        throw new RangeError('halfLifeDays must be in (0, 90]');
    if (options.positionFirstBp < 0 || options.positionLastBp < 0 || options.positionFirstBp + options.positionLastBp > 10_000)
        throw new RangeError('position shares must be non-negative and add up to at most 10000 bp');
    const dataDriven = { ...data_driven_1.DEFAULT_DATA_DRIVEN, ...(p?.dataDriven ?? {}) };
    if (!(dataDriven.minConversions >= 100) || !(dataDriven.minNodeK >= 10))
        throw new RangeError('data-driven needs at least 100 conversions and a node k of at least 10');
    return { windows, options, dataDriven };
}
//# sourceMappingURL=model-config.js.map