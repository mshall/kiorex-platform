"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.claims = claims;
const text_1 = require("../text");
function claims(p, c) {
    const hay = ` ${(0, text_1.tokens)(`${p.title} ${p.description} ${p.h1.join(' ')} ${p.text}`).join(' ')} `;
    const phrases = [...c.cfg.forbiddenClaims.en, ...c.cfg.forbiddenClaims.ar];
    const hit = phrases.find((ph) => { const t = (0, text_1.tokens)(ph).join(' '); return t.length > 0 && hay.includes(` ${t} `); });
    return hit ? [{ id: 'claims', ok: false, severity: 'block', detail: `claim phrase: ${hit}` }] : [{ id: 'claims', ok: true, severity: 'block' }];
}
//# sourceMappingURL=claims.js.map