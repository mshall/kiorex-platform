"use strict";
var __decorate = (this && this.__decorate) || function (decorators, target, key, desc) {
    var c = arguments.length, r = c < 3 ? target : desc === null ? desc = Object.getOwnPropertyDescriptor(target, key) : desc, d;
    if (typeof Reflect === "object" && typeof Reflect.decorate === "function") r = Reflect.decorate(decorators, target, key, desc);
    else for (var i = decorators.length - 1; i >= 0; i--) if (d = decorators[i]) r = (c < 3 ? d(r) : c > 3 ? d(target, key, r) : d(target, key)) || r;
    return c > 3 && r && Object.defineProperty(target, key, r), r;
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BundleRenderer = exports.SiteRenderer = void 0;
const common_1 = require("@nestjs/common");
const node_fs_1 = require("node:fs");
const node_path_1 = require("node:path");
const site_config_1 = require("./site.config");
class SiteRenderer {
}
exports.SiteRenderer = SiteRenderer;
let BundleRenderer = class BundleRenderer extends SiteRenderer {
    log = new common_1.Logger('SiteRenderer');
    mod = null;
    mtime = 0;
    assetsCache = null;
    available() { return (0, node_fs_1.existsSync)((0, site_config_1.siteCfg)().ssrBundle); }
    load() {
        const file = (0, site_config_1.siteCfg)().ssrBundle;
        const m = (0, node_fs_1.statSync)(file).mtimeMs;
        if (!this.mod || m !== this.mtime) {
            delete require.cache[require.resolve(file)];
            const loaded = require(file);
            if (typeof loaded.render !== 'function')
                throw new Error('SSR bundle does not export render()');
            this.mod = loaded;
            this.mtime = m;
            this.log.log(`SSR bundle loaded (${file})`);
        }
        return this.mod;
    }
    async render(input) {
        const timeout = (0, site_config_1.siteCfg)().renderTimeoutMs;
        return await Promise.race([
            Promise.resolve(this.load().render(input)),
            new Promise((_, rej) => { const t = setTimeout(() => rej(new Error(`SSR render timed out after ${timeout} ms`)), timeout); t.unref(); }),
        ]);
    }
    assets() {
        const dir = (0, site_config_1.siteCfg)().publicClientDir;
        const manifestFile = (0, node_path_1.join)(dir, '.vite', 'manifest.json');
        if (!(0, node_fs_1.existsSync)(manifestFile))
            return { css: '', script: null, modulePreloads: [], fontPreloads: [] };
        const key = `${manifestFile}:${(0, node_fs_1.statSync)(manifestFile).mtimeMs}`;
        if (this.assetsCache?.key === key)
            return this.assetsCache.value;
        const manifest = JSON.parse((0, node_fs_1.readFileSync)(manifestFile, 'utf8'));
        const prefix = (0, site_config_1.siteCfg)().assetPrefix;
        const url = (f) => `${prefix}/${f}`;
        const entry = Object.values(manifest).find((e) => e.isEntry);
        const css = [...new Set([...(entry?.css ?? []), ...(entry?.imports ?? []).flatMap((i) => manifest[i]?.css ?? []), ...Object.values(manifest).filter((e) => e.file.endsWith('.css')).map((e) => e.file)])]
            .map((f) => ((0, node_fs_1.existsSync)((0, node_path_1.join)(dir, f)) ? (0, node_fs_1.readFileSync)((0, node_path_1.join)(dir, f), 'utf8') : '')).join('');
        const fonts = Object.values(manifest).filter((e) => /\.woff2$/.test(e.file)).map((e) => url(e.file));
        const value = {
            css, script: entry ? url(entry.file) : null,
            modulePreloads: (entry?.imports ?? []).map((i) => manifest[i]?.file).filter((f) => !!f).map(url),
            fontPreloads: fonts.filter((f) => /plex-arabic-400|jost-latin(?!-ext)/.test(f)),
        };
        this.assetsCache = { key, value };
        return value;
    }
    spaShell() {
        const f = (0, site_config_1.siteCfg)().spaShell;
        return (0, node_fs_1.existsSync)(f) ? (0, node_fs_1.readFileSync)(f, 'utf8') : null;
    }
};
exports.BundleRenderer = BundleRenderer;
exports.BundleRenderer = BundleRenderer = __decorate([
    (0, common_1.Injectable)()
], BundleRenderer);
//# sourceMappingURL=ssr-renderer.js.map