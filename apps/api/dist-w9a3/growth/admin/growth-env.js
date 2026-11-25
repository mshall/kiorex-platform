"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INSTANCE_ID = exports.isProductionSite = exports.siteEnvironment = void 0;
const siteEnvironment = () => {
    const v = (process.env.SITE_ENVIRONMENT ?? '').trim();
    return v === 'production' || v === 'staging' ? v : 'development';
};
exports.siteEnvironment = siteEnvironment;
const isProductionSite = () => (0, exports.siteEnvironment)() === 'production';
exports.isProductionSite = isProductionSite;
exports.INSTANCE_ID = process.env.GROWTH_INSTANCE_ID ?? `${process.env.SITE_ROLE ?? 'api'}@${process.env.HOSTNAME ?? 'local'}:${process.pid}`;
//# sourceMappingURL=growth-env.js.map