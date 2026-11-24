"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.widgetCfg = void 0;
const node_path_1 = require("node:path");
const env = (k, d = '') => process.env[k] ?? d;
const bool = (k, d) => (process.env[k] === undefined || process.env[k] === '' ? d : process.env[k] === 'true');
const widgetCfg = () => {
    const nonProd = env('NODE_ENV') !== 'production' && !['production', 'staging'].includes(env('SITE_ENVIRONMENT', 'development'));
    return {
        enabled: bool('WIDGET_ENABLED', true),
        host: env('WIDGET_HOST', env('NODE_ENV') === 'production' ? 'book.kiorex.com' : '').toLowerCase().replace(/^https?:\/\//, '').replace(/\/+$/, ''),
        dist: env('WIDGET_DIST', (0, node_path_1.resolve)(__dirname, '..', '..', '..', 'widget', 'dist')),
        nonProd,
        devOrigins: nonProd ? env('WIDGET_DEV_ORIGINS').split(',').map((s) => s.trim()).filter(Boolean) : [],
        sandbox: bool('WIDGET_SANDBOX', true),
        oidcAuthority: env('OIDC_ISSUER', 'http://localhost:4400').replace(/\/+$/, ''),
        oidcClientId: env('WIDGET_OIDC_CLIENT_ID', 'kiorex-widget'),
        patientUrl: env('WEB_BASE_URL', 'http://localhost:5180').replace(/\/+$/, ''),
    };
};
exports.widgetCfg = widgetCfg;
//# sourceMappingURL=widget.config.js.map