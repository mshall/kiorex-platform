"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SECRET_REF = exports.UpstreamError = exports.NeedsHumanError = exports.GROWTH_INTEGRATION_KINDS = void 0;
exports.GROWTH_INTEGRATION_KINDS = ['googleads', 'searchconsole', 'ga4', 'playconsole', 'appstoreconnect', 'metaads', 'tiktok', 'whatsappcloud', 'fcmapns', 'crux'];
class NeedsHumanError extends Error {
    kind;
    reason;
    code = 'NEEDS_HUMAN';
    constructor(kind, reason) {
        super(`NEEDS_HUMAN: ${kind} ${reason}`);
        this.kind = kind;
        this.reason = reason;
    }
}
exports.NeedsHumanError = NeedsHumanError;
class UpstreamError extends Error {
    errorCode;
    status;
    constructor(errorCode, status) {
        super(errorCode + (status ? `:${status}` : ''));
        this.errorCode = errorCode;
        this.status = status;
    }
}
exports.UpstreamError = UpstreamError;
exports.SECRET_REF = /^[a-z0-9/_-]{1,120}$/;
//# sourceMappingURL=types.js.map