"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.readiness = readiness;
const onboarding_steps_1 = require("./onboarding-steps");
const PLACEHOLDER = /^TODO_NEEDS_HUMAN/;
function readiness(f) {
    const items = [];
    const step = (id, label) => {
        const p = f.steps[id];
        if (id === 'geography') {
            items.push({ id, status: f.geography.cities > 0 ? 'DONE' : 'TODO', detail: `${f.geography.cities} cities, ${f.geography.districts} districts` });
            return;
        }
        if (!p) {
            items.push({ id, status: 'TODO', detail: `${label} not answered yet` });
            return;
        }
        const errs = (0, onboarding_steps_1.validateStep)(id, p);
        items.push({ id, status: errs.length ? 'TODO' : 'DONE', detail: errs[0] ?? label });
    };
    for (const s of onboarding_steps_1.STEPS)
        step(s, s);
    const reg = f.steps.regulation;
    items.push({ id: 'marketingLicence', status: reg?.marketingLicenceRequired === false || reg?.marketingLicenceHeld === true ? 'DONE' : 'NEEDS_HUMAN', detail: 'Direct-marketing licence position; growth.marketing_messaging stays launch-locked either way', humanOwner: 'counsel' });
    const t = (f.steps.consent?.textVersionIds ?? {});
    items.push({ id: 'consentTexts', status: t.analytics && t.marketing && !PLACEHOLDER.test(t.analytics) && !PLACEHOLDER.test(t.marketing) ? 'DONE' : 'NEEDS_HUMAN', detail: 'Approved consent wording ids per language (the wording itself is written by counsel)', humanOwner: 'counsel' });
    items.push({ id: 'legalTexts', status: 'NEEDS_HUMAN', detail: 'Privacy notice, terms, health-advertising wording and data-export rules for the market', humanOwner: 'counsel' });
    const cfg = ['MARKET_PROFILE', 'MARKET_GROWTH', 'CONSENT_DEFAULTS'].map((k) => f.versions[k] ?? 'NONE');
    items.push({ id: 'configVersions', status: cfg.every((v) => v === 'ACTIVE') ? 'DONE' : cfg.some((v) => v === 'PENDING_APPROVAL' || v === 'APPROVED') ? 'AWAITING_CHECKER' : 'TODO', detail: `MARKET_PROFILE ${cfg[0]}, MARKET_GROWTH ${cfg[1]}, CONSENT_DEFAULTS ${cfg[2]}` });
    items.push({ id: 'flagDefinition', status: f.flagDefined ? 'DONE' : 'TODO', detail: 'The market.<cc>.live flag exists (launch-locked, OFF)' });
    items.push({ id: 'launchGate', status: f.live ? 'DONE' : 'NEEDS_HUMAN', detail: 'Market pack certification and local counsel; recorded by a person in the super admin, never by code', humanOwner: 'founder' });
    const todo = items.filter((i) => i.status === 'TODO' || i.status === 'AWAITING_CHECKER').length;
    return { items, ready: todo === 0, live: f.live, todo, needsHuman: items.filter((i) => i.status === 'NEEDS_HUMAN').length };
}
//# sourceMappingURL=readiness.js.map