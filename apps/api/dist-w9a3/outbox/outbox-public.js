"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.OutboxModule = exports.backoffMs = exports.OUTBOX_MAX_ATTEMPTS = exports.OutboxService = void 0;
var outbox_service_1 = require("./outbox.service");
Object.defineProperty(exports, "OutboxService", { enumerable: true, get: function () { return outbox_service_1.OutboxService; } });
Object.defineProperty(exports, "OUTBOX_MAX_ATTEMPTS", { enumerable: true, get: function () { return outbox_service_1.OUTBOX_MAX_ATTEMPTS; } });
Object.defineProperty(exports, "backoffMs", { enumerable: true, get: function () { return outbox_service_1.backoffMs; } });
var outbox_module_1 = require("./outbox.module");
Object.defineProperty(exports, "OutboxModule", { enumerable: true, get: function () { return outbox_module_1.OutboxModule; } });
//# sourceMappingURL=outbox-public.js.map