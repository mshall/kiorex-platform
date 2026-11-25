"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.moneyHash = exports.moneyPayload = void 0;
const contracts_1 = require("@kiorex/contracts");
const growth_secrets_1 = require("../growth-secrets");
const moneyPayload = (c) => ({
    budgetTotalMinor: c.budgetTotalMinor, budgetDailyMinor: c.budgetDailyMinor, currency: c.currency, channels: [...c.channels].sort(),
    startsAt: c.startsAt ? new Date(c.startsAt).toISOString() : null, endsAt: c.endsAt ? new Date(c.endsAt).toISOString() : null, eligibility: c.eligibility ?? {},
});
exports.moneyPayload = moneyPayload;
const moneyHash = (c) => (0, growth_secrets_1.sha256Hex)((0, contracts_1.growthCanonicalJson)((0, exports.moneyPayload)(c)));
exports.moneyHash = moneyHash;
//# sourceMappingURL=campaign-hash.js.map