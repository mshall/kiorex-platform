"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.whatsappMetaMapping = void 0;
const mapping_types_1 = require("./mapping-types");
const meta_whatsapp_1 = require("./vendors/meta-whatsapp");
const whatsapp_mapping_1 = require("./whatsapp.mapping");
exports.whatsappMetaMapping = {
    authHeaders: mapping_types_1.bearer,
    buildSend: (i) => {
        const numbered = Object.keys(i.variables ?? {}).filter((k) => /^\d+$/.test(k)).sort((a, b) => Number(a) - Number(b)).map((k) => i.variables[k]);
        return { path: `/${encodeURIComponent(i.senderId)}/messages`, body: (0, meta_whatsapp_1.metaTemplateBody)({ to: i.to, templateName: (0, whatsapp_mapping_1.whatsappTemplateName)(i.templateId), language: i.locale === 'en' ? 'en' : 'ar', bodyParams: numbered.length ? numbered : i.variables?.code ? [i.variables.code] : [i.body], urlButtonParam: i.variables?.code }) };
    },
    parseSend: meta_whatsapp_1.parseMetaSend,
    parseStatusWebhook: (raw) => (0, meta_whatsapp_1.parseMetaWebhook)(raw).statuses.map((s) => ({ providerRef: s.providerRef, status: s.status, ...(s.error ? { error: s.error } : {}), ...(s.occurredAt ? { occurredAt: s.occurredAt } : {}) })),
    parseInbound: (raw) => (0, meta_whatsapp_1.parseMetaWebhook)(raw).inbound,
    verifyWebhook: (o) => (0, meta_whatsapp_1.verifyMetaSignature)(o.secret, o.rawBody, o.headers),
    verifyChallenge: meta_whatsapp_1.metaVerifyChallenge,
};
//# sourceMappingURL=whatsapp.meta.mapping.js.map