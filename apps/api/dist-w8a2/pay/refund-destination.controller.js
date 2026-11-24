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
exports.RefundDestinationController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const refund_destination_service_1 = require("./refund-destination.service");
class PreviewBody {
    bookingRef;
}
__decorate([
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MinLength)(3),
    (0, class_validator_1.MaxLength)(80),
    __metadata("design:type", String)
], PreviewBody.prototype, "bookingRef", void 0);
let RefundDestinationController = class RefundDestinationController {
    svc;
    constructor(svc) {
        this.svc = svc;
    }
    preview(u, b) { return this.svc.preview(u.sub, b.bookingRef); }
};
exports.RefundDestinationController = RefundDestinationController;
__decorate([
    (0, common_1.Post)('preview'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'GRW-P2-B2 both refund destinations with the exact amounts; "original payment method" is the default and is first' }),
    (0, swagger_1.ApiOkResponse)({ schema: { type: 'object', additionalProperties: true } }),
    __param(0, (0, auth_1.CurrentUser)()),
    __param(1, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object, PreviewBody]),
    __metadata("design:returntype", void 0)
], RefundDestinationController.prototype, "preview", null);
exports.RefundDestinationController = RefundDestinationController = __decorate([
    (0, swagger_1.ApiTags)('growth-credit'),
    (0, common_1.Controller)('pay/v1/refunds'),
    __metadata("design:paramtypes", [refund_destination_service_1.RefundDestinationService])
], RefundDestinationController);
//# sourceMappingURL=refund-destination.controller.js.map