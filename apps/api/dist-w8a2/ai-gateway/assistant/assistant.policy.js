"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.isState = exports.isToolName = exports.LIMITS = exports.BUTTON_ONLY_TOOLS = exports.SUBJECT_TOOLS = exports.UNVERIFIED_TOOLS = exports.TOOLS_BY_STATE = void 0;
exports.allowedTools = allowedTools;
const assistant_types_1 = require("./assistant.types");
const ALWAYS = ['handoff_to_human', 'end_conversation', 'create_booking_link'];
const BROWSE = ['search_providers', 'get_next_available', 'get_my_bookings'];
exports.TOOLS_BY_STATE = {
    GREETING: [...ALWAYS, ...BROWSE],
    UNDERSTAND: [...ALWAYS, ...BROWSE],
    SEARCHING: [...ALWAYS, ...BROWSE, 'get_slots'],
    PICKING: [...ALWAYS, ...BROWSE, 'get_slots', 'hold_slot', 'join_waitlist', 'cancel_booking', 'reschedule_booking'],
    HOLDING: [...ALWAYS, 'get_slots', 'hold_slot', 'prepare_confirmation'],
    CONFIRMING: [...ALWAYS, 'confirm_booking', 'get_my_bookings'],
    DONE: [...ALWAYS, ...BROWSE, 'cancel_booking', 'reschedule_booking'],
    CANCEL_FLOW: [...ALWAYS, 'get_my_bookings', 'cancel_booking', 'confirm_booking'],
    RESCHEDULE_FLOW: [...ALWAYS, 'get_my_bookings', 'get_slots', 'reschedule_booking', 'confirm_booking'],
    HANDOFF: [],
    CLOSED: [...ALWAYS, ...BROWSE],
};
exports.UNVERIFIED_TOOLS = ['search_providers', 'get_slots', 'get_next_available', 'create_booking_link', 'handoff_to_human', 'end_conversation'];
exports.SUBJECT_TOOLS = ['hold_slot', 'prepare_confirmation', 'confirm_booking', 'get_my_bookings', 'reschedule_booking', 'cancel_booking', 'join_waitlist'];
exports.BUTTON_ONLY_TOOLS = ['confirm_booking'];
exports.LIMITS = {
    maxInboundChars: 1000,
    maxToolSteps: 4,
    maxDateRangeDays: 30,
    holdMinutes: 5,
    confirmTtlMinutes: 10,
    linkTtlMinutes: 15,
    maxSearchResults: 3,
    maxSlotsShown: 5,
    dedupeWindowMs: 30_000,
    sessionHours: 24,
    clarifyFailuresBeforeHandoff: 2,
};
function allowedTools(state, verified, narrow) {
    let list = [...(exports.TOOLS_BY_STATE[state] ?? [])];
    const cfgList = narrow?.[state];
    if (Array.isArray(cfgList))
        list = list.filter((t) => cfgList.includes(t));
    if (!verified)
        list = list.filter((t) => exports.UNVERIFIED_TOOLS.includes(t));
    return list;
}
const isToolName = (s) => typeof s === 'string' && assistant_types_1.TOOL_NAMES.includes(s);
exports.isToolName = isToolName;
const isState = (s) => typeof s === 'string' && assistant_types_1.SESSION_STATES.includes(s);
exports.isState = isState;
//# sourceMappingURL=assistant.policy.js.map