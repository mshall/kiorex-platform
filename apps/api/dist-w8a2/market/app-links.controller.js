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
exports.AppLinksController = void 0;
const common_1 = require("@nestjs/common");
const swagger_1 = require("@nestjs/swagger");
const auth_1 = require("../common/auth");
const config_1 = require("../common/config");
const app_links_1 = require("./app-links");
let AppLinksController = class AppLinksController {
    serve(res, body, placeholder) {
        if (placeholder && (0, config_1.cfg)().isProd) {
            res.status(404).json({ code: 'NOT_CONFIGURED', message: 'App link association is not configured' });
            return;
        }
        res.setHeader('Content-Type', 'application/json; charset=utf-8');
        res.setHeader('Cache-Control', 'public, max-age=300');
        res.setHeader('X-Content-Type-Options', 'nosniff');
        if (placeholder)
            res.setHeader('X-Kiorex-App-Links', 'placeholder');
        res.status(200).send(JSON.stringify(body));
    }
    aasa(res) { const r = (0, app_links_1.resolveAppLinksConfig)((0, app_links_1.appLinksConfigFromEnv)()); this.serve(res, (0, app_links_1.buildAppleAppSiteAssociation)(r), r.teamPlaceholder); }
    assetlinks(res) { const r = (0, app_links_1.resolveAppLinksConfig)((0, app_links_1.appLinksConfigFromEnv)()); this.serve(res, (0, app_links_1.buildAssetLinks)(r), r.fingerprintPlaceholder); }
};
exports.AppLinksController = AppLinksController;
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('apple-app-site-association'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AppLinksController.prototype, "aasa", null);
__decorate([
    (0, auth_1.Public)(),
    (0, common_1.Get)('assetlinks.json'),
    __param(0, (0, common_1.Res)()),
    __metadata("design:type", Function),
    __metadata("design:paramtypes", [Object]),
    __metadata("design:returntype", void 0)
], AppLinksController.prototype, "assetlinks", null);
exports.AppLinksController = AppLinksController = __decorate([
    (0, swagger_1.ApiExcludeController)(),
    (0, common_1.Controller)('.well-known')
], AppLinksController);
//# sourceMappingURL=app-links.controller.js.map