"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.templateOf = exports.defaultHttp = exports.RealAdapter = exports.realAdapterFor = exports.REAL_SPECS = void 0;
__exportStar(require("./adapters/growth/types"), exports);
var registry_1 = require("./adapters/growth/registry");
Object.defineProperty(exports, "REAL_SPECS", { enumerable: true, get: function () { return registry_1.REAL_SPECS; } });
Object.defineProperty(exports, "realAdapterFor", { enumerable: true, get: function () { return registry_1.realAdapterFor; } });
var real_adapter_1 = require("./adapters/growth/real-adapter");
Object.defineProperty(exports, "RealAdapter", { enumerable: true, get: function () { return real_adapter_1.RealAdapter; } });
Object.defineProperty(exports, "defaultHttp", { enumerable: true, get: function () { return real_adapter_1.defaultHttp; } });
var searchconsole_adapter_1 = require("./adapters/growth/searchconsole.adapter");
Object.defineProperty(exports, "templateOf", { enumerable: true, get: function () { return searchconsole_adapter_1.templateOf; } });
//# sourceMappingURL=platform-public.js.map