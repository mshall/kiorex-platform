"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.forbidden = exports.DENY_NAME_TOKENS = exports.DENY_TAGS = exports.surfaceByKey = exports.SURFACES = void 0;
exports.nameHitsDenylist = nameHitsDenylist;
exports.assertSurfaceAllowed = assertSurfaceAllowed;
exports.assertFlagKeyAllowed = assertFlagKeyAllowed;
const errors_1 = require("../../common/errors");
exports.SURFACES = [
    { key: 'landing.home.hero_copy', label: 'Home page hero headline and sub-line', tags: ['marketing-copy'], units: ['VISITOR', 'SUB'], ssr: true, platforms: ['web'] },
    { key: 'landing.provider.cta_label', label: 'Provider page booking button label', tags: ['marketing-copy', 'cta'], units: ['VISITOR', 'SUB'], ssr: true, platforms: ['web'] },
    { key: 'landing.search.empty_state', label: 'Search no-results suggestion copy', tags: ['marketing-copy'], units: ['VISITOR', 'SUB'], ssr: true, platforms: ['web'] },
    { key: 'signup.value_proposition', label: 'Sign-up page value proposition', tags: ['marketing-copy'], units: ['VISITOR', 'SUB'], ssr: false, platforms: ['web', 'ios', 'android'] },
    { key: 'app.home.tile_order', label: 'App home tile order (non-clinical tiles)', tags: ['layout'], units: ['SUB'], ssr: false, platforms: ['ios', 'android'] },
    { key: 'referral.invite_prompt', label: 'Referral invite prompt wording', tags: ['marketing-copy'], units: ['SUB'], ssr: false, platforms: ['web', 'ios', 'android'] },
    { key: 'booking.post_booking.share_prompt', label: 'Share prompt after a confirmed booking', tags: ['marketing-copy'], units: ['SUB'], ssr: false, platforms: ['web', 'ios', 'android'] },
    { key: 'lifecycle.winback.subject_line', label: 'Win-back message subject line (marketing purpose only)', tags: ['marketing-copy', 'messaging'], units: ['SUB'], ssr: false, platforms: ['web'] },
];
const surfaceByKey = (k) => exports.SURFACES.find((s) => s.key === k);
exports.surfaceByKey = surfaceByKey;
exports.DENY_TAGS = ['emergency', 'triage', 'symptom-checker', 'safety-copy', 'privacy', 'consent', 'regulatory', 'clinical', 'price-disclosure', 'fee-disclosure', 'cancellation-policy', 'payment', 'commission', 'attribution-policy', 'credit', 'reward-rules'];
exports.DENY_NAME_TOKENS = [
    'emergency', 'triage', 'symptom', 'safety', 'consent', 'privacy', 'regulat', 'clinical', 'diagnos', 'prescri', 'pricing', 'price', 'cancel', 'refund', 'payment', 'deposit', 'commission', 'attribution',
];
function nameHitsDenylist(name, extraTokens = []) {
    const n = name.toLowerCase();
    for (const t of [...exports.DENY_NAME_TOKENS, ...extraTokens])
        if (t && n.includes(t.toLowerCase()))
            return t;
    if (/(^|[._-])(fees?|credits?|rewards?|sos|mfa|audit|recall)([._-]|$)/.test(n))
        return 'fee|credit|reward|sos|mfa|audit|recall';
    return null;
}
const forbidden = (surface, why) => new errors_1.ApiError(422, 'EXPERIMENT_SURFACE_FORBIDDEN', `Surface "${surface}" cannot host an experiment: ${why}`, { surface });
exports.forbidden = forbidden;
function assertSurfaceAllowed(surface, tags = [], extraTokens = []) {
    const hit = nameHitsDenylist(surface, extraTokens);
    if (hit)
        throw (0, exports.forbidden)(surface, `its name matches the never-experiment list (${hit})`);
    const bad = [...tags].find((t) => exports.DENY_TAGS.includes(t.toLowerCase()));
    if (bad)
        throw (0, exports.forbidden)(surface, `tag "${bad}" is on the never-experiment list`);
    const def = (0, exports.surfaceByKey)(surface);
    if (!def)
        throw (0, exports.forbidden)(surface, 'it is not on the allowlist of experiment surfaces');
    const own = def.tags.find((t) => exports.DENY_TAGS.includes(t));
    if (own)
        throw (0, exports.forbidden)(surface, `registry tag "${own}" is on the never-experiment list`);
    return def;
}
function assertFlagKeyAllowed(flagKey, extraTokens = []) {
    const hit = nameHitsDenylist(flagKey, extraTokens);
    if (hit || /^(market|pay|kiorex\.pay|growth\.(patient_credit|refund_as_credit|family_credit|support_goodwill|sponsored_promotions|rewards|marketing_messaging|patient_referral))/.test(flagKey)) {
        throw new errors_1.ApiError(422, 'EXPERIMENT_FLAG_FORBIDDEN', `Flag "${flagKey}" cannot be linked to an experiment (safety, money or launch-locked key)`, { flagKey });
    }
}
//# sourceMappingURL=surfaces.js.map