"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.growthError = void 0;
const contracts_1 = require("@kiorex/contracts");
const errors_1 = require("../common/errors");
const growthError = (code, message, extra = {}) => new errors_1.ApiError(contracts_1.GROWTH_ERROR_STATUS[code], code, message, extra);
exports.growthError = growthError;
//# sourceMappingURL=growth-errors.js.map