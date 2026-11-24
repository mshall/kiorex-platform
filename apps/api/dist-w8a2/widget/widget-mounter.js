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
exports.WidgetMounter = void 0;
const common_1 = require("@nestjs/common");
const core_1 = require("@nestjs/core");
const embed_controller_1 = require("./embed.controller");
const widget_config_1 = require("./widget.config");
let WidgetMounter = class WidgetMounter {
    host;
    h;
    log = new common_1.Logger('widget');
    constructor(host, h) {
        this.host = host;
        this.h = h;
    }
    onModuleInit() {
        const app = this.host.httpAdapter?.getInstance();
        if (!(0, widget_config_1.widgetCfg)().enabled || !app || typeof app.get !== 'function') {
            this.log.log('widget host not mounted');
            return;
        }
        app.get('/v1/embed/auth/callback', this.h.callback);
        app.get('/v1/embed/assets/:file', this.h.asset);
        app.get('/v1/embed/:orgSlug', this.h.shell);
        app.get('/v1/sdk.js', this.h.sdk(false));
        app.get('/v1/sdk.json', this.h.sdkInfo);
        app.get(/^\/v1\/([a-f0-9]{16})\/sdk\.js$/, this.h.sdk(true));
        app.get('/v1/sandbox', this.h.sandbox);
        this.log.log(`widget host mounted (host=${(0, widget_config_1.widgetCfg)().host || 'any (development)'})`);
    }
};
exports.WidgetMounter = WidgetMounter;
exports.WidgetMounter = WidgetMounter = __decorate([
    (0, common_1.Injectable)(),
    __metadata("design:paramtypes", [core_1.HttpAdapterHost, embed_controller_1.EmbedHandlers])
], WidgetMounter);
//# sourceMappingURL=widget-mounter.js.map