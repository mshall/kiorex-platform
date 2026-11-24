"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.backoffMs = exports.BREAKER_COOLDOWN_MS = exports.BREAKER_THRESHOLD = void 0;
exports.allowRun = allowRun;
exports.afterRun = afterRun;
exports.BREAKER_THRESHOLD = 5;
exports.BREAKER_COOLDOWN_MS = 30 * 60_000;
function allowRun(s, now, cooldownMs = exports.BREAKER_COOLDOWN_MS) {
    if (s.circuit === 'CLOSED')
        return { allowed: true, next: 'CLOSED' };
    if (s.circuit === 'HALF_OPEN')
        return { allowed: true, next: 'HALF_OPEN' };
    return s.lastErrorAt && now.getTime() - s.lastErrorAt.getTime() >= cooldownMs ? { allowed: true, next: 'HALF_OPEN' } : { allowed: false, next: 'OPEN' };
}
function afterRun(s, ok, now, threshold = exports.BREAKER_THRESHOLD) {
    if (ok)
        return { circuit: 'CLOSED', consecutiveFailures: 0, lastErrorAt: s.lastErrorAt };
    const n = s.consecutiveFailures + 1;
    return { circuit: s.circuit === 'HALF_OPEN' || n >= threshold ? 'OPEN' : s.circuit, consecutiveFailures: n, lastErrorAt: now };
}
const backoffMs = (attempt, rand = Math.random, base = 500, cap = 30_000) => Math.floor(rand() * Math.min(cap, base * 2 ** attempt));
exports.backoffMs = backoffMs;
//# sourceMappingURL=circuit.js.map