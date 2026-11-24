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
var __param = (this && this.__param) || function (paramIndex, decorator) {
    return function (target, key) { decorator(target, key, paramIndex); }
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.AnalyticsController = exports.IngestResultDto = exports.ClientEventsBody = exports.ClientEventBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_transformer_1 = require("class-transformer");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const analytics_service_1 = require("./analytics.service");
class ClientEventBody {
    name;
    props;
}
exports.ClientEventBody = ClientEventBody;
__decorate([
    (0, swagger_1.ApiProperty)({ enum: [...analytics_service_1.CLIENT_EVENTS] }),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(60),
    __metadata("design:type", String)
], ClientEventBody.prototype, "name", void 0);
__decorate([
    (0, swagger_1.ApiPropertyOptional)({ description: `Only these keys are accepted: ${analytics_service_1.ALLOWED_PROPS.join(', ')}. Values: specialty code, id, ISO market, SCREAMING_SNAKE code. Anything else is a 400.`, type: 'object', additionalProperties: { type: 'string' } }),
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsObject)(),
    __metadata("design:type", Object)
], ClientEventBody.prototype, "props", void 0);
class ClientEventsBody {
    events;
}
exports.ClientEventsBody = ClientEventsBody;
__decorate([
    (0, swagger_1.ApiProperty)({ type: [ClientEventBody] }),
    (0, class_validator_1.IsArray)(),
    (0, class_validator_1.ArrayMinSize)(1),
    (0, class_validator_1.ValidateNested)({ each: true }),
    (0, class_transformer_1.Type)(() => ClientEventBody),
    __metadata("design:type", Array)
], ClientEventsBody.prototype, "events", void 0);
class IngestResultDto {
    accepted;
}
exports.IngestResultDto = IngestResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], IngestResultDto.prototype, "accepted", void 0);
let AnalyticsController = class AnalyticsController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    ingest(b) { return this.svc.ingest(b.events); }
};
exports.AnalyticsController = AnalyticsController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Post)('events'),
    (0, common_1.HttpCode)(202),
    (0, swagger_1.ApiOperation)({ summary: 'KX-03 §07 client analytics (PHI-free whitelist, anonymous, all-or-nothing batch)' }),
    (0, swagger_1.ApiAcceptedResponse)({ type: IngestResultDto }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [ClientEventsBody]),
    __metadata("design:returntype", void 0)
], AnalyticsController.prototype, "ingest", null);
exports.AnalyticsController = AnalyticsController = __decorate([
    (0, swagger_1.ApiTags)('analytics'),
    (0, common_1.Controller)('analytics'),
    __metadata("design:paramtypes", [analytics_service_1.AnalyticsService])
], AnalyticsController);
//# sourceMappingURL=analytics.controller.js.map