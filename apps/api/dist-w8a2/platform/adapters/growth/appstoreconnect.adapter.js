"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.appStoreConnectSpec = void 0;
const types_1 = require("./types");
exports.appStoreConnectSpec = {
    kind: 'appstoreconnect', api: 'analyticsReportRequests', host: 'api.appstoreconnect.apple.com', pulls: ['performance'],
    build: (_r, secret, _w, account) => ({ url: `https://api.appstoreconnect.apple.com/v1/apps/${encodeURIComponent(account)}/analyticsReportRequests`, method: 'GET', headers: { authorization: `Bearer ${secret}` } }),
    parse: () => { throw new types_1.NeedsHumanError('appstoreconnect', 'response shape not recorded yet (H-9)'); },
};
//# sourceMappingURL=appstoreconnect.adapter.js.map