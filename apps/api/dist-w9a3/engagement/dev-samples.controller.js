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
exports.DevSamplesController = exports.DevSamplesResultDto = exports.DevSamplesBody = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const class_validator_1 = require("class-validator");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const errors_1 = require("../common/errors");
const messaging_public_1 = require("../messaging/messaging-public");
const templates_1 = require("./templates");
class DevSamplesBody {
    phone;
    email;
    locale;
}
exports.DevSamplesBody = DevSamplesBody;
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(64),
    __metadata("design:type", String)
], DevSamplesBody.prototype, "phone", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsString)(),
    (0, class_validator_1.MaxLength)(120),
    __metadata("design:type", String)
], DevSamplesBody.prototype, "email", void 0);
__decorate([
    (0, class_validator_1.IsOptional)(),
    (0, class_validator_1.IsIn)(['ar', 'en']),
    __metadata("design:type", String)
], DevSamplesBody.prototype, "locale", void 0);
class DevSamplesResultDto {
    sent;
    templates;
}
exports.DevSamplesResultDto = DevSamplesResultDto;
__decorate([
    (0, swagger_1.ApiProperty)(),
    __metadata("design:type", Number)
], DevSamplesResultDto.prototype, "sent", void 0);
__decorate([
    (0, swagger_1.ApiProperty)({ type: [String] }),
    __metadata("design:type", Array)
], DevSamplesResultDto.prototype, "templates", void 0);
const SAMPLES = [
    ['BOOKING_CONFIRMED', { doctor: 'Dr. Amira Samy', time: 'Sun 23 Nov 10:30' }],
    ['REMINDER_24H', { doctor: 'Dr. Amira Samy', time: 'Sun 23 Nov 10:30' }],
    ['WAITLIST_OFFER', { doctor: 'Dr. Amira Samy', time: 'Mon 24 Nov 09:00', until: '09:15' }],
    ['DEPOSIT_REFUNDED', {}],
];
let DevSamplesController = class DevSamplesController {
    hub;
    constructor(hub) {
        this.hub = hub;
    }
    async samples(b) {
        if (!(0, config_1.cfg)().devRoutesEnabled)
            throw (0, errors_1.notFound)('NOT_FOUND', 'Not found');
        const phone = b.phone ?? '+201000000001';
        const email = b.email ?? 'demo.patient@example.test';
        const locale = b.locale ?? 'en';
        let sent = 0;
        for (const [kind, params] of SAMPLES) {
            const t = templates_1.TEMPLATES[kind];
            const body = (0, templates_1.render)(locale === 'en' ? t.en : t.ar, params);
            for (const [channel, to] of [['WHATSAPP', phone], ['SMS', phone], ['EMAIL', email]]) {
                if ((await this.hub.send({ channel, to, templateId: t.templateId, locale, body })).ok)
                    sent++;
            }
        }
        return { sent, templates: SAMPLES.map(([k]) => templates_1.TEMPLATES[k].templateId) };
    }
};
exports.DevSamplesController = DevSamplesController;
__decorate([
    (0, swagger_1.ApiOkResponse)({ type: DevSamplesResultDto }),
    (0, common_1.Post)('samples'),
    (0, common_1.HttpCode)(200),
    (0, swagger_1.ApiOperation)({ summary: 'DEV: send sample booking-confirmation / reminder / waitlist-offer / deposit-refund messages through the WhatsApp, SMS and email mocks' }),
    __param(0, (0, common_1.Body)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [DevSamplesBody]),
    __metadata("design:returntype", Promise)
], DevSamplesController.prototype, "samples", null);
exports.DevSamplesController = DevSamplesController = __decorate([
    (0, swagger_1.ApiTags)('dev'),
    (0, auth_1.Public)(),
    (0, common_1.Controller)('dev/messaging'),
    __metadata("design:paramtypes", [messaging_public_1.MessagingHub])
], DevSamplesController);
//# sourceMappingURL=dev-samples.controller.js.map