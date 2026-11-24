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
exports.AiGatewayController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const ai_gateway_service_1 = require("./ai-gateway.service");
const ai_dto_1 = require("./ai.dto");
class NavBody {
    text;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(1000),
    __metadata("design:type", String)
], NavBody.prototype, "text", void 0);
let AiGatewayController = class AiGatewayController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    navigate(u, b) { return this.svc.navigate(u.sub, b.text); }
};
exports.AiGatewayController = AiGatewayController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: ai_dto_1.NavigationResultDto }),
    (0, common_1.Post)('symptoms'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'Symptom → specialty navigation (emergency check first; AI only when kiorex.ai_navigation is effective, else keyword map)' }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, NavBody]),
    __metadata("design:returntype", void 0)
], AiGatewayController.prototype, "navigate", null);
exports.AiGatewayController = AiGatewayController = __decorate([
    (0, swagger_1.ApiTags)('ai'),
    (0, common_1.Controller)('navigation'),
    __metadata("design:paramtypes", [ai_gateway_service_1.AiGatewayService])
], AiGatewayController);
//# sourceMappingURL=ai-gateway.controller.js.map