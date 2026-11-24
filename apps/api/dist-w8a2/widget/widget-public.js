"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.snippetsFor = exports.originOfUrl = exports.sanitizeRegisteredOrigins = exports.frameAncestorsOf = exports.isOriginAllowed = exports.WidgetRegistrationService = exports.WidgetModule = void 0;
var widget_module_1 = require("./widget.module");
Object.defineProperty(exports, "WidgetModule", { enumerable: true, get: function () { return widget_module_1.WidgetModule; } });
var widget_registration_service_1 = require("./widget-registration.service");
Object.defineProperty(exports, "WidgetRegistrationService", { enumerable: true, get: function () { return widget_registration_service_1.WidgetRegistrationService; } });
var widget_origins_1 = require("./widget-origins");
Object.defineProperty(exports, "isOriginAllowed", { enumerable: true, get: function () { return widget_origins_1.isOriginAllowed; } });
Object.defineProperty(exports, "frameAncestorsOf", { enumerable: true, get: function () { return widget_origins_1.frameAncestorsOf; } });
Object.defineProperty(exports, "sanitizeRegisteredOrigins", { enumerable: true, get: function () { return widget_origins_1.sanitizeRegisteredOrigins; } });
Object.defineProperty(exports, "originOfUrl", { enumerable: true, get: function () { return widget_origins_1.originOfUrl; } });
var widget_snippets_1 = require("./widget-snippets");
Object.defineProperty(exports, "snippetsFor", { enumerable: true, get: function () { return widget_snippets_1.snippetsFor; } });
//# sourceMappingURL=widget-public.js.map