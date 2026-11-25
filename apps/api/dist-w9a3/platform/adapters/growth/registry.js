"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.realAdapterFor = exports.REAL_SPECS = void 0;
const googleads_adapter_1 = require("./googleads.adapter");
const searchconsole_adapter_1 = require("./searchconsole.adapter");
const ga4_adapter_1 = require("./ga4.adapter");
const playconsole_adapter_1 = require("./playconsole.adapter");
const appstoreconnect_adapter_1 = require("./appstoreconnect.adapter");
const metaads_adapter_1 = require("./metaads.adapter");
const tiktok_adapter_1 = require("./tiktok.adapter");
const whatsappcloud_adapter_1 = require("./whatsappcloud.adapter");
const fcmapns_adapter_1 = require("./fcmapns.adapter");
const crux_adapter_1 = require("./crux.adapter");
const real_adapter_1 = require("./real-adapter");
exports.REAL_SPECS = {
    googleads: googleads_adapter_1.googleAdsSpec, searchconsole: searchconsole_adapter_1.searchConsoleSpec, ga4: ga4_adapter_1.ga4Spec, playconsole: playconsole_adapter_1.playConsoleSpec, appstoreconnect: appstoreconnect_adapter_1.appStoreConnectSpec,
    metaads: metaads_adapter_1.metaAdsSpec, tiktok: tiktok_adapter_1.tiktokSpec, whatsappcloud: whatsappcloud_adapter_1.whatsappCloudSpec, fcmapns: fcmapns_adapter_1.fcmApnsSpec, crux: crux_adapter_1.cruxSpec,
};
const realAdapterFor = (kind, cfg) => new real_adapter_1.RealAdapter(exports.REAL_SPECS[kind], cfg);
exports.realAdapterFor = realAdapterFor;
//# sourceMappingURL=registry.js.map