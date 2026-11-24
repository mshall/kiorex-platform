"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.outboundFetch = outboundFetch;
exports.isBenignSocketError = isBenignSocketError;
exports.installProcessSafetyNet = installProcessSafetyNet;
const common_1 = require("@nestjs/common");
function outboundFetch(input, init = {}) {
    const headers = new Headers(init.headers);
    headers.set('connection', 'close');
    return fetch(input, { ...init, headers });
}
function isBenignSocketError(e) {
    const err = e;
    if (!err || typeof err !== 'object')
        return false;
    if (err.syscall === 'setTypeOfService' && err.code === 'EINVAL')
        return true;
    return ['ECONNRESET', 'EPIPE', 'ECONNABORTED'].includes(String(err.code)) && /socket|read|write/.test(String(err.syscall ?? 'socket'));
}
function installProcessSafetyNet(log = new common_1.Logger('process')) {
    process.on('uncaughtException', (e) => {
        if (isBenignSocketError(e)) {
            log.warn(`ignored non-fatal socket error: ${e.message} (${e.code})`);
            return;
        }
        log.error(`uncaught exception, exiting: ${e?.stack ?? e}`);
        process.exit(1);
    });
    process.on('unhandledRejection', (e) => {
        if (isBenignSocketError(e)) {
            log.warn(`ignored non-fatal socket rejection: ${e.message}`);
            return;
        }
        log.error(`unhandled rejection: ${e?.stack ?? e}`);
    });
}
//# sourceMappingURL=outbound-http.js.map