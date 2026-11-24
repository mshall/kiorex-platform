"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappMapping = void 0;
exports.whatsappTemplateName = whatsappTemplateName;
const mapping_types_1 = require("./mapping-types");
function whatsappTemplateName(templateId, env = process.env) {
    try {
        const m = JSON.parse(env.WHATSAPP_TEMPLATE_MAP ?? '{}');
        return typeof m?.[templateId] === 'string' ? m[templateId] : templateId;
    }
    catch {
        return templateId;
    }
}
exports.whatsappMapping = {
    authHeaders: mapping_types_1.bearer,
    buildSend: (i) => ({ path: '/messages', body: { to: i.to, from: i.senderId, type: 'template', template: { name: whatsappTemplateName(i.templateId), language: i.locale === 'en' ? 'en' : 'ar', variables: { body: i.body, ...(i.variables ?? {}) } }, reference: i.reference } }),
    parseSend: mapping_types_1.parseGenericSend,
    parseStatusWebhook: mapping_types_1.parseGenericStatus,
    verifyWebhook: mapping_types_1.genericVerify,
};
//# sourceMappingURL=whatsapp.mapping.js.map