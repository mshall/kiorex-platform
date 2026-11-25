"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.FallbackChain = exports.ModelTimeoutError = exports.ModelUnavailableError = void 0;
const common_1 = require("@nestjs/common");
class ModelUnavailableError extends Error {
}
exports.ModelUnavailableError = ModelUnavailableError;
class ModelTimeoutError extends Error {
}
exports.ModelTimeoutError = ModelTimeoutError;
class FallbackChain {
    models;
    log = new common_1.Logger('assistant-model');
    breakers = new Map();
    last = null;
    o;
    constructor(models, o = {}) {
        this.models = models;
        this.o = { timeoutMs: o.timeoutMs ?? 8000, failuresToOpen: o.failuresToOpen ?? 3, openMs: o.openMs ?? 60_000, now: o.now ?? Date.now };
    }
    get name() { return this.models.map((m) => m.name).join('>'); }
    get mode() { return (this.last ?? this.models[0])?.mode ?? 'mock'; }
    lastUsage() { return this.last?.lastUsage?.() ?? { tokensIn: 0, tokensOut: 0, costMinor: 0 }; }
    breakerOpen(name) { const b = this.breakers.get(name); return !!b && b.openUntil > this.o.now(); }
    async step(i) {
        for (const m of this.models) {
            if (this.breakerOpen(m.name))
                continue;
            try {
                const step = await this.withTimeout(m.step(i));
                this.breakers.delete(m.name);
                this.last = m;
                return step;
            }
            catch (e) {
                const b = this.breakers.get(m.name) ?? { failures: 0, openUntil: 0 };
                b.failures += 1;
                if (b.failures >= this.o.failuresToOpen) {
                    b.openUntil = this.o.now() + this.o.openMs;
                    b.failures = 0;
                    this.log.warn(`model ${m.name} breaker open for ${this.o.openMs} ms`);
                }
                this.breakers.set(m.name, b);
                this.log.warn(`model ${m.name} failed: ${e.constructor.name}`);
            }
        }
        throw new ModelUnavailableError('no model available');
    }
    withTimeout(p) {
        let t;
        const timeout = new Promise((_r, rej) => { t = setTimeout(() => rej(new ModelTimeoutError('model timeout')), this.o.timeoutMs); t.unref?.(); });
        return Promise.race([p, timeout]).finally(() => clearTimeout(t));
    }
}
exports.FallbackChain = FallbackChain;
//# sourceMappingURL=fallback.chain.js.map