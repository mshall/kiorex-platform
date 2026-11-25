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
exports.REF_CODE_RE = exports.PROVIDER_LINK_CODE_RE = exports.isSafeSegment = exports.isRefCode = exports.normalizeProviderCode = exports.chooseMarket = exports.IOS_APP_LINK_PATHS = exports.appLinksConfigFromEnv = exports.resolveAppLinksConfig = exports.buildAssetLinks = exports.buildAppleAppSiteAssociation = exports.MarketModule = exports.MarketService = void 0;
var market_service_1 = require("./market.service");
Object.defineProperty(exports, "MarketService", { enumerable: true, get: function () { return market_service_1.MarketService; } });
var market_module_1 = require("./market.module");
Object.defineProperty(exports, "MarketModule", { enumerable: true, get: function () { return market_module_1.MarketModule; } });
var app_links_1 = require("./app-links");
Object.defineProperty(exports, "buildAppleAppSiteAssociation", { enumerable: true, get: function () { return app_links_1.buildAppleAppSiteAssociation; } });
Object.defineProperty(exports, "buildAssetLinks", { enumerable: true, get: function () { return app_links_1.buildAssetLinks; } });
Object.defineProperty(exports, "resolveAppLinksConfig", { enumerable: true, get: function () { return app_links_1.resolveAppLinksConfig; } });
Object.defineProperty(exports, "appLinksConfigFromEnv", { enumerable: true, get: function () { return app_links_1.appLinksConfigFromEnv; } });
Object.defineProperty(exports, "IOS_APP_LINK_PATHS", { enumerable: true, get: function () { return app_links_1.IOS_APP_LINK_PATHS; } });
var deep_link_rules_1 = require("./deep-link-rules");
Object.defineProperty(exports, "chooseMarket", { enumerable: true, get: function () { return deep_link_rules_1.chooseMarket; } });
Object.defineProperty(exports, "normalizeProviderCode", { enumerable: true, get: function () { return deep_link_rules_1.normalizeProviderCode; } });
Object.defineProperty(exports, "isRefCode", { enumerable: true, get: function () { return deep_link_rules_1.isRefCode; } });
Object.defineProperty(exports, "isSafeSegment", { enumerable: true, get: function () { return deep_link_rules_1.isSafeSegment; } });
Object.defineProperty(exports, "PROVIDER_LINK_CODE_RE", { enumerable: true, get: function () { return deep_link_rules_1.PROVIDER_LINK_CODE_RE; } });
Object.defineProperty(exports, "REF_CODE_RE", { enumerable: true, get: function () { return deep_link_rules_1.REF_CODE_RE; } });
__exportStar(require("./market-core-public"), exports);
//# sourceMappingURL=market-public.js.map