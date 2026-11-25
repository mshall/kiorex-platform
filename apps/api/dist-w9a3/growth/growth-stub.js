"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.notBuiltYet = void 0;
const errors_1 = require("../common/errors");
const notBuiltYet = (key, pkg) => new errors_1.ApiError(404, 'FEATURE_DISABLED', `Not available yet (${pkg})`, { key, scope: 'global', pkg, stub: true });
exports.notBuiltYet = notBuiltYet;
//# sourceMappingURL=growth-stub.js.map