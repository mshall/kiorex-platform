"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.CROSS_LINK_KINDS = exports.ANCHOR_KINDS = void 0;
exports.candidatesFor = candidatesFor;
const page_model_1 = require("./page-model");
exports.ANCHOR_KINDS = ['PARENT', 'CLINIC', 'DOCTOR', 'HUB', 'NEIGHBOUR', 'RELATED', 'CHILD', 'ORPHAN_FIX'];
exports.CROSS_LINK_KINDS = ['PARENT', 'NEIGHBOUR', 'RELATED', 'CHILD', 'HUB'];
const byQuality = (a, b) => b.quality - a.quality || Number(b.available) - Number(a.available) || (a.key < b.key ? -1 : 1);
function candidatesFor(n, all, o) {
    const out = [];
    let r = 0;
    const add = (to, rule, kind, rank = r++) => { if (to && to !== n.key)
        out.push({ from: n.key, to, rule, kind, rank }); };
    const { type } = (0, page_model_1.splitKey)(n.key);
    if (type !== 'home') {
        add((0, page_model_1.parentKey)(n.key), 'BREADCRUMB', 'PARENT');
        add((0, page_model_1.keyOf)('home', ''), 'BREADCRUMB', 'PARENT');
    }
    if (type === 'doctor' || type === 'nurse') {
        add(n.clinicKey, 'DOCTOR_CLINIC', 'CLINIC', 0);
        for (const h of (n.hubKeys ?? []).filter((k) => all.get(k)?.linkable).slice(0, 2))
            add(h, 'DOCTOR_HUB', 'HUB');
    }
    if (type === 'clinic')
        for (const d of [...(n.clinicDoctors ?? [])].sort(byQuality).slice(0, o.clinicDoctors))
            add(d.key, 'CLINIC_DOCTORS', 'DOCTOR');
    if (['hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine'].includes(type)) {
        for (const d of [...(n.doctors ?? [])].sort(byQuality).slice(0, o.topDoctors))
            add(d.key, 'HUB_TOP_DOCTORS', 'DOCTOR');
    }
    if (type === 'district' || type === 'district-hub' || type === 'care-district') {
        const sibs = [...all.values()].filter((x) => x.key !== n.key && x.type === n.type && (0, page_model_1.parentKey)(x.key) === (0, page_model_1.parentKey)(n.key)).sort((a, b) => (b.providerCount ?? 0) - (a.providerCount ?? 0) || (a.key < b.key ? -1 : 1));
        for (const s of sibs)
            add(s.key, 'NEIGHBOUR_DISTRICTS', 'NEIGHBOUR');
    }
    if (type === 'hub') {
        const slug = (0, page_model_1.splitKey)(n.key).rest;
        for (const rel of o.related[slug] ?? [])
            add((0, page_model_1.keyOf)('hub', rel), 'RELATED_SPECIALTIES', 'RELATED');
    }
    if (type === 'hub' || type === 'city' || type === 'city-hub') {
        const kids = [...all.values()].filter((x) => (0, page_model_1.parentKey)(x.key) === n.key).sort((a, b) => (b.providerCount ?? 0) - (a.providerCount ?? 0) || (a.key < b.key ? -1 : 1));
        for (const k of kids)
            add(k.key, 'PARENT_CHILDREN', 'CHILD');
    }
    return out;
}
//# sourceMappingURL=link-rules.js.map