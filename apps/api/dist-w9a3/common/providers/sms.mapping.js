"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.smsMapping = void 0;
const mapping_types_1 = require("./mapping-types");
exports.smsMapping = {
    authHeaders: mapping_types_1.bearer,
    buildSend: (i) => ({ path: '/messages', body: { to: i.to, from: i.senderId, body: i.body, reference: i.reference } }),
    parseSend: mapping_types_1.parseGenericSend,
    parseStatusWebhook: mapping_types_1.parseGenericStatus,
    verifyWebhook: mapping_types_1.genericVerify,
};
//# sourceMappingURL=sms.mapping.js.map