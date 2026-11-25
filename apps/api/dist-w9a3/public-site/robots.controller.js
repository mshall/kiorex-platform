"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.RobotsController = void 0;
const common_1 = require("@nestjs/common");
const headers_1 = require("./headers");
const robots_1 = require("./robots");
const url_policy_1 = require("./url-policy");
const site_config_1 = require("./site.config");
let RobotsController = class RobotsController {
    handle = (req, res) => {
        const c = (0, site_config_1.siteCfg)();
        const body = (0, robots_1.buildRobots)({ indexable: c.indexable, canonicalHost: c.canonicalHost, locales: url_policy_1.LOCALES });
        const etag = (0, headers_1.etagOf)(body);
        res.set({ ...(0, headers_1.textSecurityHeaders)(), 'Content-Type': 'text/plain; charset=utf-8', 'Cache-Control': 'public, max-age=300, s-maxage=3600', ETag: etag, ...(c.indexable ? {} : { 'X-Robots-Tag': 'noindex' }) });
        if ((0, headers_1.etagMatches)(req.headers['if-none-match'], etag)) {
            res.status(304).end();
            return;
        }
        res.status(200).send(body);
    };
};
exports.RobotsController = RobotsController;
exports.RobotsController = RobotsController = __decorate([
    (0, common_1.Injectable)()
], RobotsController);
//# sourceMappingURL=robots.controller.js.map