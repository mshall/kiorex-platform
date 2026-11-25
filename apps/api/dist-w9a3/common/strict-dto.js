"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.runWithStrictFlag = exports.StrictOpsValidationPipe = exports.isOpsPath = exports.strictOpsEnabled = void 0;
exports.strictDtoMiddleware = strictDtoMiddleware;
const node_async_hooks_1 = require("node:async_hooks");
const common_1 = require("@nestjs/common");
const als = new node_async_hooks_1.AsyncLocalStorage();
const strictOpsEnabled = () => (process.env.STRICT_DTO ?? '').split(',').map((s) => s.trim()).includes('ops');
exports.strictOpsEnabled = strictOpsEnabled;
const isOpsPath = (url) => /^\/api\/v1\/admin(\/|\?|$)/.test(url);
exports.isOpsPath = isOpsPath;
function strictDtoMiddleware(req, _res, next) {
    als.run({ strict: (0, exports.strictOpsEnabled)() && (0, exports.isOpsPath)(req.originalUrl ?? req.url ?? '') }, next);
}
class StrictOpsValidationPipe {
    lenient = new common_1.ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: false });
    strict = new common_1.ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true });
    transform(value, metadata) { return (als.getStore()?.strict ? this.strict : this.lenient).transform(value, metadata); }
}
exports.StrictOpsValidationPipe = StrictOpsValidationPipe;
const runWithStrictFlag = (strict, fn) => als.run({ strict }, fn);
exports.runWithStrictFlag = runWithStrictFlag;
//# sourceMappingURL=strict-dto.js.map