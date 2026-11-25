"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.progressPct = exports.needsHandshakeCreds = exports.KIND_FLAGS = exports.AUTO_STEPS = exports.CONN_KINDS = void 0;
exports.gateFlags = gateFlags;
exports.computeSteps = computeSteps;
exports.goLiveBlockers = goLiveBlockers;
exports.CONN_KINDS = ['CLINIC', 'NURSE', 'PHARMACY', 'LAB'];
exports.AUTO_STEPS = ['credentials', 'handshake', 'sync_dry_run', 'flags', 'market_pack', 'duplicates', 'documents'];
exports.KIND_FLAGS = {
    CLINIC: [{ key: 'kiorex.marketplace', launchLocked: false }, { key: 'clinic.kiorex_listing', launchLocked: false }],
    NURSE: [{ key: 'kiorex.marketplace', launchLocked: false }, { key: 'clinic.kiorex_listing', launchLocked: false }],
    PHARMACY: [{ key: 'kiorex.pharmacy_orders', launchLocked: true }, { key: 'pharmacy.kiorex_orders', launchLocked: false }],
    LAB: [{ key: 'kiorex.lab_bookings', launchLocked: true }, { key: 'lab.kiorex_bookings', launchLocked: false }],
};
const needsHandshakeCreds = (k) => k === 'PHARMACY' || k === 'LAB';
exports.needsHandshakeCreds = needsHandshakeCreds;
const autoFrom = (key, c) => {
    const r = c.items?.[key];
    if (!r)
        return { key, type: 'AUTO', state: 'PENDING' };
    const state = r.status === 'PASSED' || r.status === 'SKIPPED' ? 'DONE' : r.status === 'WARN' ? 'WARN' : 'FAILED';
    return { key, type: 'AUTO', state, code: r.code, detail: r.detail };
};
function gateFlags(c) {
    return (c.items?.flags?.detail?.gates ?? []);
}
function computeSteps(i) {
    const steps = [];
    for (const k of exports.AUTO_STEPS)
        steps.push(autoFrom(k, i.checks));
    const autoOk = steps.every((s) => s.state === 'DONE' || s.state === 'WARN');
    const humanState = (done) => (done ? 'DONE' : 'ACTION');
    steps.push({ key: 'review_documents', type: 'HUMAN', actor: 'ops_admin', state: i.human.documents ? 'DONE' : i.checks.items?.documents?.status === 'PASSED' ? 'ACTION' : 'LOCKED', code: i.human.documents ? undefined : 'NEEDS_DOCUMENTS_CHECK' });
    steps.push({ key: 'verify_licence', type: 'HUMAN', actor: 'ops_admin', state: i.human.licence ? 'DONE' : 'ACTION' });
    steps.push({ key: 'fees', type: 'HUMAN', actor: 'ops_admin', state: humanState(!!i.human.fees), link: '/policy' });
    const gates = gateFlags(i.checks);
    if (gates.length)
        steps.push({ key: 'launch_gate', type: 'HUMAN', actor: 'super_admin', state: gates.every((g) => g.satisfied) ? 'DONE' : 'ACTION', link: '/flags', detail: { gates } });
    const humanDone = steps.filter((s) => s.type === 'HUMAN').every((s) => s.state === 'DONE');
    const st = i.status;
    const approved = ['APPROVED', 'LIVE', 'PAUSED'].includes(st);
    steps.push({ key: 'approval', type: 'HUMAN', actor: 'super_admin', state: approved ? 'DONE' : st === 'AWAITING_APPROVAL' ? 'ACTION' : autoOk && humanDone ? 'ACTION' : 'LOCKED', code: st === 'AWAITING_APPROVAL' ? 'AWAITING_SECOND_PERSON' : undefined, detail: { requestedBy: i.requestedBy ?? null, approvedBy: i.approvedBy ?? null } });
    steps.push({ key: 'go_live', type: 'HUMAN', actor: 'ops_admin', state: st === 'LIVE' ? 'DONE' : st === 'APPROVED' && autoOk && humanDone ? 'ACTION' : 'LOCKED' });
    return steps;
}
const progressPct = (steps) => Math.round((steps.filter((s) => s.state === 'DONE' || s.state === 'WARN').length / steps.length) * 100);
exports.progressPct = progressPct;
function goLiveBlockers(i) {
    const steps = computeSteps(i);
    const out = steps.filter((s) => s.key !== 'go_live' && s.state !== 'DONE' && s.state !== 'WARN').map((s) => `STEP_${s.key.toUpperCase()}`);
    if (i.status !== 'APPROVED' && !out.includes('STEP_APPROVAL'))
        out.push('NOT_APPROVED');
    return out;
}
//# sourceMappingURL=steps.js.map