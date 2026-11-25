"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.SIMULATABLE_STATES = exports.MSG_CHANNELS = void 0;
exports.maskRecipient = maskRecipient;
exports.MSG_CHANNELS = ['EMAIL', 'WHATSAPP', 'SMS', 'PUSH'];
exports.SIMULATABLE_STATES = ['DELIVERED', 'READ', 'FAILED'];
function maskRecipient(channel, to) {
    if (channel === 'EMAIL') {
        const [u, d] = to.split('@');
        return d ? `${u.slice(0, 1)}***@${d}` : '***';
    }
    if (channel === 'PUSH')
        return 'push:****';
    return to.length > 6 ? `${to.slice(0, 4)}****${to.slice(-3)}` : '***';
}
//# sourceMappingURL=messaging.types.js.map