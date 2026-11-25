"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.resetGuards = exports.registerGuard = exports.defaultGuard = void 0;
exports.evaluateGuard = evaluateGuard;
exports.overlapPercent = overlapPercent;
const ENTITY_TYPES = ['doctor', 'clinic', 'nurse', 'pharmacy', 'lab', 'home', 'static'];
const AVAILABILITY_TYPES = ['same-day', 'telemedicine'];
const defaultGuard = (input, p) => {
    if (ENTITY_TYPES.includes(input.type))
        return { indexable: true, reasons: [] };
    if (input.type === 'hub')
        return input.liveProviders >= 1 ? { indexable: true, reasons: [] } : { indexable: false, reasons: ['NO_LIVE_PROVIDERS'] };
    const reasons = [];
    if (AVAILABILITY_TYPES.includes(input.type)) {
        const min = p.minAvailableProviders ?? 2;
        if (input.liveProviders < min)
            reasons.push(`AVAILABLE_PROVIDERS_BELOW_${min}`);
    }
    else if (input.liveProviders < p.minLiveProviders)
        reasons.push(`LIVE_PROVIDERS_BELOW_${p.minLiveProviders}`);
    if (input.uniqueBlocks < p.minUniqueBlocks)
        reasons.push(`UNIQUE_BLOCKS_BELOW_${p.minUniqueBlocks}`);
    if (input.siblingOverlapPercent !== null && input.siblingOverlapPercent > p.maxSiblingSimilarityPercent)
        reasons.push(`SIBLING_OVERLAP_ABOVE_${p.maxSiblingSimilarityPercent}`);
    const parentMax = p.maxParentSimilarityPercent ?? 100;
    if (input.parentOverlapPercent != null && input.parentOverlapPercent >= parentMax)
        reasons.push(`PARENT_OVERLAP_AT_OR_ABOVE_${parentMax}`);
    return { indexable: reasons.length === 0, reasons };
};
exports.defaultGuard = defaultGuard;
const overrides = new Map();
const registerGuard = (type, fn) => { overrides.set(type, fn); };
exports.registerGuard = registerGuard;
const resetGuards = () => overrides.clear();
exports.resetGuards = resetGuards;
function evaluateGuard(input, params) {
    return (overrides.get(input.type) ?? exports.defaultGuard)(input, params);
}
function overlapPercent(a, b) {
    if (!a.length)
        return 0;
    const set = new Set(b);
    return Math.round((a.filter((x) => set.has(x)).length / a.length) * 100);
}
//# sourceMappingURL=thin-page-guard.js.map