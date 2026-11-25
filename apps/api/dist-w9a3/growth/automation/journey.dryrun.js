"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.syntheticCohort = syntheticCohort;
exports.dryRun = dryRun;
const send_gate_1 = require("../lifecycle/send-gate");
const lifecycle_segments_1 = require("../lifecycle/lifecycle-segments");
const quiet_hours_1 = require("../lifecycle/quiet-hours");
function rng(seed) { let a = seed >>> 0; return () => { a = (a + 0x6d2b79f5) >>> 0; let t = a; t = Math.imul(t ^ (t >>> 15), t | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const pick = (r, xs) => xs[Math.floor(r() * xs.length)];
function syntheticCohort(size, seed) {
    const r = rng(seed);
    const out = [];
    for (let i = 0; i < size; i++) {
        out.push({
            id: `syn-${i}`,
            facts: { stage: pick(r, ['REGISTERED', 'ACTIVATED', 'BOOKED', 'ATTENDED', 'RETAINED', 'DORMANT', 'CHURNED']), platform: pick(r, ['web', 'ios', 'android']), language: r() < 0.8 ? 'ar' : 'en', city: pick(r, ['Cairo', 'Giza', 'Alexandria']), district: null, registeredDaysAgo: Math.floor(r() * 700), lastBookingDaysAgo: r() < 0.15 ? null : Math.floor(r() * 400), hasDependants: r() < 0.2, referralStatus: pick(r, ['NONE', 'NONE', 'INVITED', 'QUALIFIED']) },
            marketingConsent: r() < 0.55, suppressed: r() < 0.05, optedOut: r() < 0.08, hasAddress: r() < 0.95,
        });
    }
    return out;
}
function dryRun(c, o) {
    const size = Math.max(10, Math.min(5000, o.size ?? 1000));
    const seed = o.seed ?? 20270128;
    const now = o.now ?? Date.UTC(2027, 0, 28, 10, 0, 0);
    const caps = o.caps ?? { perDay: 1, perWeek: 3 };
    const quiet = (0, quiet_hours_1.quietWindow)(o.quiet ?? (0, quiet_hours_1.defaultQuiet)(), null);
    const people = syntheticCohort(size, seed);
    const exits = {};
    const bump = (k) => { exits[k] = (exits[k] ?? 0) + 1; };
    const steps = c.def.steps.map((s) => ({ step: s.step, template: s.kind, messageClass: s.messageClass, reached: 0, sent: 0, skipped: {}, deferred: 0 }));
    const sentCount = new Map();
    const variantsOf = new Map();
    for (const s of c.def.steps)
        for (const b of s.branch ?? [])
            variantsOf.set(b.experiment, [...new Set([...(variantsOf.get(b.experiment) ?? []), b.variant])].sort());
    for (const p of people) {
        const armOf = (exp) => { const vs = variantsOf.get(exp) ?? ['control']; return vs[hash(`${seed}:${p.id}:${exp}`) % vs.length]; };
        let ended = false;
        for (const [i, s] of c.def.steps.entries()) {
            if (ended)
                break;
            if (s.branch?.some((b) => armOf(b.experiment) !== b.variant))
                continue;
            const row = steps[i];
            row.reached++;
            if (s.segments?.some((seg) => !(0, lifecycle_segments_1.inSegment)(seg, p.facts))) {
                bump('CONDITION_FALSE');
                ended = true;
                break;
            }
            if ((sentCount.get(p.id) ?? 0) >= c.def.custom.maxSends) {
                bump('SEND_CAP');
                ended = true;
                break;
            }
            let outcome = { decision: 'SKIP', reason: 'NO_ADDRESS' };
            let chosen = null;
            for (const ch of s.channels) {
                outcome = (0, send_gate_1.evaluateSendGate)({
                    messageClass: s.messageClass, channel: ch, now, journeyEnabled: true, marketingFlagOn: o.marketingFlagOn, inHoldout: s.messageClass === 'MARKETING' && (hash(`${p.id}:${c.def.key}`) % 10_000) < (o.holdoutBps ?? 0),
                    consent: s.messageClass === 'MARKETING' ? p.marketingConsent : true, channelOptedOut: p.optedOut, suppressed: p.suppressed, quiet, sentDay: 0, sentWeek: sentCount.get(p.id) ?? 0, caps, whatsappWindowOpen: false, templateApproved: true,
                    hasAddress: p.hasAddress, phiHits: [], duplicate: false,
                });
                if (outcome.decision === 'SEND') {
                    chosen = ch;
                    break;
                }
                if (outcome.reason === 'MARKETING_FLAG_OFF' || outcome.reason === 'HOLDOUT')
                    break;
            }
            if (outcome.decision === 'SEND' && chosen) {
                row.sent++;
                sentCount.set(p.id, (sentCount.get(p.id) ?? 0) + 1);
                continue;
            }
            if (outcome.decision === 'SKIP') {
                if (outcome.reason === 'QUIET_HOURS') {
                    row.deferred++;
                    continue;
                }
                row.skipped[outcome.reason] = (row.skipped[outcome.reason] ?? 0) + 1;
                if (s.messageClass === 'MARKETING' && (outcome.reason === 'SUPPRESSED' || outcome.reason === 'NO_CONSENT')) {
                    bump(outcome.reason === 'SUPPRESSED' ? 'EXIT_SUPPRESSED' : 'EXIT_CONSENT');
                    ended = true;
                }
            }
        }
    }
    const totalSent = steps.reduce((a, s) => a + s.sent, 0);
    return {
        cohort: size, seed, steps, totalSent, exits, gateNodes: c.gateNodes, perPersonMax: c.def.custom.maxSends, marketingFlagOn: o.marketingFlagOn,
        note: { en: 'A synthetic cohort, no real person. The gate decisions are the real ones; quiet hours defer a send, they do not drop it.', ar: 'مجموعة تجريبية بدون أي شخص حقيقي. قرارات البوابة هي نفسها الفعلية، وساعات الهدوء تؤجل الإرسال ولا تلغيه.' },
    };
}
function hash(s) { let h = 2166136261; for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
} return h >>> 0; }
//# sourceMappingURL=journey.dryrun.js.map