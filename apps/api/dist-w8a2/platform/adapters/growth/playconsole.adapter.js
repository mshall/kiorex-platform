"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.playConsoleSpec = void 0;
const types_1 = require("./types");
exports.playConsoleSpec = {
    kind: 'playconsole', api: 'playdeveloperreporting.v1beta1', host: 'playdeveloperreporting.googleapis.com', pulls: ['performance'],
    build: (_r, secret, _w, account) => ({ url: `https://playdeveloperreporting.googleapis.com/v1beta1/apps/${encodeURIComponent(account)}/crashRateMetricSet:query`, method: 'POST', headers: { authorization: `Bearer ${secret}`, 'content-type': 'application/json' }, body: '{}' }),
    parse: () => { throw new types_1.NeedsHumanError('playconsole', 'response shape not recorded yet (H-9)'); },
};
//# sourceMappingURL=playconsole.adapter.js.map