"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.twilioCreds = exports.smsTwilioMapping = void 0;
const twilio_sms_1 = require("./vendors/twilio-sms");
Object.defineProperty(exports, "twilioCreds", { enumerable: true, get: function () { return twilio_sms_1.twilioCreds; } });
exports.smsTwilioMapping = {
    authHeaders: twilio_sms_1.twilioAuth,
    buildSend: (i) => ({ path: (0, twilio_sms_1.twilioPath)(i.apiKey ?? ''), form: (0, twilio_sms_1.twilioForm)({ to: i.to, from: i.senderId, body: i.body, statusCallback: i.publicWebhookUrl }) }),
    parseSend: twilio_sms_1.parseTwilioSend,
    parseStatusWebhook: (raw) => (0, twilio_sms_1.parseTwilioStatus)(raw),
    verifyWebhook: (o) => (0, twilio_sms_1.verifyTwilioSignature)(o.secret, o.publicUrl ?? '', o.rawBody, o.headers),
};
//# sourceMappingURL=sms.twilio.mapping.js.map