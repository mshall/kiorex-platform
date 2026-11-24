"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.emptyContext = exports.CLARIFY_SLOTS = exports.REPLY_INTENTS = exports.TOOL_NAMES = exports.SESSION_STATES = void 0;
exports.SESSION_STATES = ['GREETING', 'UNDERSTAND', 'SEARCHING', 'PICKING', 'HOLDING', 'CONFIRMING', 'DONE', 'CANCEL_FLOW', 'RESCHEDULE_FLOW', 'HANDOFF', 'CLOSED'];
exports.TOOL_NAMES = ['search_providers', 'get_slots', 'get_next_available', 'hold_slot', 'prepare_confirmation', 'confirm_booking', 'get_my_bookings', 'reschedule_booking', 'cancel_booking', 'join_waitlist', 'create_booking_link', 'handoff_to_human', 'end_conversation'];
exports.REPLY_INTENTS = ['greet', 'ask_specialty', 'symptom_choose_specialty', 'use_buttons', 'thanks', 'offer_help', 'cannot_help', 'medical_redirect', 'unverified_notice'];
exports.CLARIFY_SLOTS = ['specialty', 'provider', 'slot', 'booking', 'date', 'any'];
const emptyContext = () => ({ shown: { providers: [], slots: [], bookings: [], specialties: [], lastList: null }, idsSeen: [], clarifyFails: 0 });
exports.emptyContext = emptyContext;
//# sourceMappingURL=assistant.types.js.map