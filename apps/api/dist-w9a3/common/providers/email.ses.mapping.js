"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emailSesMapping = void 0;
const ses_1 = require("./vendors/ses");
exports.emailSesMapping = {
    authHeaders: () => ({}),
    buildSend: (i) => ({
        path: '/v2/email/outbound-emails',
        body: (0, ses_1.sesSendBody)({ from: i.senderId, to: i.to, subject: i.subject ?? 'Kiorex', text: i.body, reference: i.reference, configurationSet: process.env.EMAIL_SES_CONFIGURATION_SET || undefined }),
        sign: i.apiUrl && i.apiKey ? (0, ses_1.sesSigner)(i.apiUrl, i.apiKey) : undefined,
    }),
    parseSend: ses_1.parseSesSend,
    parseStatusWebhook: (raw) => (0, ses_1.parseSesEvents)(raw),
    verifyWebhook: (o) => (0, ses_1.verifySnsBasicAuth)(o.secret, o.headers),
    subscriptionConfirmUrl: ses_1.snsConfirmUrl,
};
//# sourceMappingURL=email.ses.mapping.js.map