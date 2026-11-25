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
exports.SeoGateTriggerService = exports.SEO_TRIGGER_DEBOUNCE_MS = void 0;
const common_1 = require("@nestjs/common");
const control_plane_public_1 = require("../../control-plane/control-plane-public");
const market_core_public_1 = require("../../market/market-core-public");
const seo_automation_public_1 = require("./seo-automation-public");
const seo_automation_service_1 = require("./seo-automation.service");
exports.SEO_TRIGGER_DEBOUNCE_MS = 60_000;
let SeoGateTriggerService = class SeoGateTriggerService {
    seo;
    flags;
    log = new common_1.Logger('seo-trigger');
    pending = new Map();
    constructor(seo, flags) {
        this.seo = seo;
        this.flags = flags;
    }
    request(reason, market = market_core_public_1.DEFAULT_MARKET) {
        try {
            const have = this.pending.get(market);
            if (have) {
                have.reasons.add(reason);
                return;
            }
            const timer = setTimeout(() => void this.flush(market).catch(() => undefined), exports.SEO_TRIGGER_DEBOUNCE_MS);
            timer.unref();
            this.pending.set(market, { timer, reasons: new Set([reason]) });
        }
        catch { }
    }
    pendingMarkets() { return [...this.pending.keys()]; }
    async flush(market = market_core_public_1.DEFAULT_MARKET) {
        const p = this.pending.get(market);
        if (!p)
            return { ran: false, reasons: [] };
        clearTimeout(p.timer);
        this.pending.delete(market);
        const reasons = [...p.reasons];
        if (!(await this.flags.isEnabled(seo_automation_public_1.SEO_AUTOMATION_FLAG, { market }).catch(() => false)))
            return { ran: false, reasons };
        try {
            await this.seo.run({ market, actor: `system:seo-trigger:${reasons.join('+').slice(0, 80)}` });
            return { ran: true, reasons };
        }
        catch (e) {
            this.log.warn(`seo gate run failed (${e.message}); the nightly job repeats it`);
            return { ran: false, reasons };
        }
    }
    onModuleDestroy() { for (const p of this.pending.values())
        clearTimeout(p.timer); this.pending.clear(); }
};
exports.SeoGateTriggerService = SeoGateTriggerService;
exports.SeoGateTriggerService = SeoGateTriggerService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [seo_automation_service_1.SeoAutomationService, control_plane_public_1.FlagsService])
], SeoGateTriggerService);
//# sourceMappingURL=seo-trigger.service.js.map