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
exports.LifecycleService = void 0;
const common_1 = require("@nestjs/common");
const journey_runner_service_1 = require("./journey-runner.service");
let LifecycleService = class LifecycleService {
    runner;
    constructor(runner) {
        this.runner = runner;
    }
    signal(s) {
        if (s.kind === 'REGISTERED')
            return this.runner.enrol({ sub: s.sub, journeyKey: 'welcome', anchorAt: s.at, params: { confirmationRequested: s.confirmationRequested } });
        const event = s.kind.slice('REWARD_'.length);
        if (s.kind === 'REWARD_EXPIRING')
            return this.runner.enrol({ sub: s.sub, journeyKey: 'reward-notice', anchorId: `${s.rewardId}:EXPIRING`, anchorAt: new Date(s.expiresAt.getTime() - 14 * 86_400_000), params: { event, date: s.expiresAt.toISOString().slice(0, 10) } });
        return this.runner.enrol({ sub: s.sub, journeyKey: 'reward-notice', anchorId: `${s.rewardId}:${event}`, anchorAt: s.at, params: { event } });
    }
};
exports.LifecycleService = LifecycleService;
exports.LifecycleService = LifecycleService = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [journey_runner_service_1.JourneyRunnerService])
], LifecycleService);
//# sourceMappingURL=lifecycle.service.js.map