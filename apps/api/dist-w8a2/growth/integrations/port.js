"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.INTEGRATION_META = exports.PULLS = exports.PAID_KINDS = exports.GROWTH_INTEGRATION_KINDS = void 0;
var platform_public_1 = require("../../platform/platform-public");
Object.defineProperty(exports, "GROWTH_INTEGRATION_KINDS", { enumerable: true, get: function () { return platform_public_1.GROWTH_INTEGRATION_KINDS; } });
exports.PAID_KINDS = ['googleads', 'metaads', 'tiktok'];
exports.PULLS = {
    googleads: ['spend', 'performance'], searchconsole: ['performance'], ga4: ['performance'], playconsole: ['performance'], appstoreconnect: ['performance'],
    metaads: ['spend', 'performance'], tiktok: ['spend', 'performance'], whatsappcloud: ['performance'], fcmapns: ['performance'], crux: ['coreVitals'],
};
exports.INTEGRATION_META = {
    googleads: { label: 'Google Ads', retentionMonths: 25, location: 'Kiorex cell (frankfurt), aggregates cross-border', rateBudgetPerMin: 60, fallback: 'manual spend entry', defaultOff: false },
    searchconsole: { label: 'Google Search Console', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'manual CSV import', defaultOff: false },
    ga4: { label: 'GA4', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'first-party analytics', defaultOff: true },
    playconsole: { label: 'Google Play Console', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 20, fallback: 'manual CSV import', defaultOff: false },
    appstoreconnect: { label: 'App Store Connect', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 20, fallback: 'manual CSV import', defaultOff: false },
    metaads: { label: 'Meta Ads', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 60, fallback: 'manual spend entry', defaultOff: false },
    tiktok: { label: 'TikTok Ads', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'manual spend entry', defaultOff: false },
    whatsappcloud: { label: 'Meta WhatsApp Cloud', retentionMonths: 25, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 30, fallback: 'MessageLog counts', defaultOff: false },
    fcmapns: { label: 'FCM and APNs', retentionMonths: 13, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 0, fallback: 'in-app channel', defaultOff: false },
    crux: { label: 'Chrome UX Report', retentionMonths: 13, location: 'Kiorex cell (frankfurt)', rateBudgetPerMin: 10, fallback: 'synthetic Lighthouse', defaultOff: false },
};
//# sourceMappingURL=port.js.map