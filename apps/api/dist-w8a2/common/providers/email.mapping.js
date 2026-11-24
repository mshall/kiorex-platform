"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailMapping = void 0;
const mapping_types_1 = require("./mapping-types");
exports.emailMapping = {
    authHeaders: mapping_types_1.bearer,
    buildSend: (i) => ({ path: '/messages', body: { to: i.to, from: i.senderId, subject: 'Kiorex', text: i.body, reference: i.reference, template: i.templateId, locale: i.locale } }),
    parseSend: mapping_types_1.parseGenericSend,
    parseStatusWebhook: mapping_types_1.parseGenericStatus,
    verifyWebhook: mapping_types_1.genericVerify,
};
//# sourceMappingURL=email.mapping.js.map