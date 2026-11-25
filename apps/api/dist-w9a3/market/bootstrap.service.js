"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
var __metadata = (this && this.__metadata) || function (k, v) {
    if (typeof Reflect === "object" && typeof Reflect.metadata === "function") return Reflect.metadata(k, v);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BootstrapService = void 0;
exports.parseEndpointBindings = parseEndpointBindings;
const common_1 = require("@nestjs/common");
const config_1 = require("../common/config");
const control_plane_public_1 = require("../control-plane/control-plane-public");
const growth_public_1 = require("../growth/growth-public");
const deep_link_rules_1 = require("./deep-link-rules");
const market_registry_1 = require("./market-registry");
const market_service_1 = require("./market.service");
function parseEndpointBindings(raw, isProd) {
    if (!raw)
        return {};
    let obj;
    try {
        obj = JSON.parse(raw);
    }
    catch {
        return {};
    }
    if (!obj || typeof obj !== 'object' || Array.isArray(obj))
        return {};
    const out = {};
    for (const [k, v] of Object.entries(obj)) {
        const cc = k.toUpperCase();
        if (!/^[A-Z]{2}$/.test(cc) || typeof v !== 'string')
            continue;
        try {
            const u = new URL(v);
            if (u.protocol !== 'https:' && !(u.protocol === 'http:' && !isProd))
                continue;
            if (u.username || u.password || u.search || u.hash)
                continue;
            out[cc] = `${u.origin}${u.pathname.replace(/\/+$/, '')}`;
        }
        catch { }
    }
    return out;
}
let BootstrapService = class BootstrapService {
    markets;
    flags;
    constructor(markets, flags) {
        this.markets = markets;
        this.flags = flags;
    }
    async get(hintCc) {
        const [known, live] = await Promise.all([this.markets.known(), this.markets.liveMarkets()]);
        const c = (0, config_1.cfg)();
        const bindings = parseEndpointBindings(process.env.REGIONAL_API_ENDPOINTS, c.isProd);
        const fallback = `${c.publicBaseUrl.replace(/\/+$/, '')}/api/v1`;
        const endpointFor = (cc) => bindings[cc] ?? fallback;
        const configuredDefault = (process.env.DEFAULT_MARKET ?? '').toUpperCase();
        const defaultMarket = live.includes(configuredDefault) ? configuredDefault : (live[0] ?? (known.includes(configuredDefault) ? configuredDefault : (known[0] ?? configuredDefault)));
        const hint = (0, deep_link_rules_1.normalizeCc)(hintCc);
        const resolvedMarket = (0, deep_link_rules_1.chooseMarket)(hint, live, defaultMarket);
        const ctx = { market: resolvedMarket };
        const [deepLinks, marketplace, homeVisits, referral] = await Promise.all([
            this.flags.isEnabled(growth_public_1.GROWTH_FLAG.DEEP_LINKS, ctx), this.flags.isEnabled('kiorex.marketplace', ctx), this.flags.isEnabled('kiorex.home_visits', ctx), this.flags.isEnabled(growth_public_1.GROWTH_FLAG.PATIENT_REFERRAL, ctx),
        ]);
        return {
            defaultMarket,
            resolvedMarket,
            liveMarkets: live,
            markets: live.map((code) => ({ code, ...(0, market_registry_1.marketFacts)(code), apiEndpoint: endpointFor(code) })),
            locales: ['ar', 'en'],
            showMarketSelector: live.length > 1,
            minAppVersion: (process.env.MIN_APP_VERSION ?? '').trim() || null,
            apiEndpoint: endpointFor(resolvedMarket),
            capabilities: { deepLinks, marketplace, homeVisits },
            features: { referral },
        };
    }
};
exports.BootstrapService = BootstrapService;
exports.BootstrapService = BootstrapService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [market_service_1.MarketService, control_plane_public_1.FlagsService])
], BootstrapService);
//# sourceMappingURL=bootstrap.service.js.map