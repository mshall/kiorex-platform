"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WidgetAssets = void 0;
const node_fs_1 = require("node:fs");
const node_crypto_1 = require("node:crypto");
const node_path_1 = require("node:path");
const common_1 = require("@nestjs/common");
const widget_config_1 = require("./widget.config");
let WidgetAssets = class WidgetAssets {
    app;
    appDir = '';
    sdk;
    files;
    load() {
        const dir = (0, widget_config_1.widgetCfg)().dist;
        if (this.app && this.appDir === dir)
            return;
        const manifestPath = (0, node_path_1.join)(dir, 'app/.vite/manifest.json');
        if (!(0, node_fs_1.existsSync)(manifestPath))
            throw new Error('WIDGET_NOT_BUILT');
        const m = JSON.parse((0, node_fs_1.readFileSync)(manifestPath, 'utf8'));
        const main = m['src/app/main.tsx']?.file;
        const callback = m['src/app/callback.ts']?.file;
        const css = m['style.css']?.file ?? null;
        if (!main || !callback)
            throw new Error('WIDGET_NOT_BUILT');
        this.app = { main, callback, css };
        this.appDir = dir;
        this.files = new Set((0, node_fs_1.readdirSync)((0, node_path_1.join)(dir, 'app')).filter((f) => /^[A-Za-z0-9._-]+\.(js|css)$/.test(f)));
        const sm = JSON.parse((0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, 'sdk/manifest.json'), 'utf8'));
        const body = (0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, 'sdk', sm.file));
        this.sdk = { manifest: sm, body, etag: `"${(0, node_crypto_1.createHash)('sha1').update(body).digest('base64url').slice(0, 27)}"` };
    }
    ready() { try {
        this.load();
        return true;
    }
    catch {
        return false;
    } }
    appFiles() { this.load(); return this.app; }
    sdkFile() { this.load(); return this.sdk; }
    appAsset(name) {
        this.load();
        if (!this.files.has(name))
            return null;
        return { body: (0, node_fs_1.readFileSync)((0, node_path_1.join)(this.appDir, 'app', name)), type: name.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/javascript; charset=utf-8' };
    }
};
exports.WidgetAssets = WidgetAssets;
exports.WidgetAssets = WidgetAssets = __decorate([
    (0, common_1.Injectable)()
], WidgetAssets);
//# sourceMappingURL=widget-assets.js.map