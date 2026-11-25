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
exports.LinkRegistryJob = void 0;
const common_1 = require("@nestjs/common");
const config_1 = require("../../common/config");
const link_registry_service_1 = require("./link-registry.service");
let LinkRegistryJob = class LinkRegistryJob {
    registry;
    log = new common_1.Logger('link-registry-job');
    timer;
    constructor(registry) {
        this.registry = registry;
    }
    onModuleInit() {
        if (!(0, config_1.cfg)().jobsEnabled)
            return;
        this.timer = setInterval(() => void this.runOnce().catch((e) => this.log.warn(`link registry reconcile failed: ${e.message}`)), 3600_000);
        this.timer.unref();
    }
    onModuleDestroy() { if (this.timer)
        clearInterval(this.timer); }
    runOnce(hours = 48) { return this.registry.reconcile(new Date(Date.now() - hours * 3600_000)); }
};
exports.LinkRegistryJob = LinkRegistryJob;
exports.LinkRegistryJob = LinkRegistryJob = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [link_registry_service_1.LinkRegistryService])
], LinkRegistryJob);
//# sourceMappingURL=link-registry.job.js.map