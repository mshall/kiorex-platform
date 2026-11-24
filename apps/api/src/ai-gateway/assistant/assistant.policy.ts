import { SESSION_STATES, TOOL_NAMES, type SessionState, type ToolName } from './assistant.types';

/**
 * GRW-P2-D policy: which tool may run in which state. This table is CODE (a safety control, never a flag): the model is told the list, the orchestrator enforces it.
 * ASSISTANT_POLICY may only NARROW a state's list (its `toolsByState` keys that equal a state name); it can never add a tool.
 */
const ALWAYS: ToolName[] = ['handoff_to_human', 'end_conversation', 'create_booking_link'];
const BROWSE: ToolName[] = ['search_providers', 'get_next_available', 'get_my_bookings'];

export const TOOLS_BY_STATE: Readonly<Record<SessionState, readonly ToolName[]>> = {
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

/** Unverified numbers (no Kiorex profile): search tools and the hand-off link only (Passport verifies on the link). */
export const UNVERIFIED_TOOLS: readonly ToolName[] = ['search_providers', 'get_slots', 'get_next_available', 'create_booking_link', 'handoff_to_human', 'end_conversation'];

/** Tools that act for the patient on their own bookings: they need a verified subject and, for the last three, the button nonce. */
export const SUBJECT_TOOLS: readonly ToolName[] = ['hold_slot', 'prepare_confirmation', 'confirm_booking', 'get_my_bookings', 'reschedule_booking', 'cancel_booking', 'join_waitlist'];
export const BUTTON_ONLY_TOOLS: readonly ToolName[] = ['confirm_booking'];

export const LIMITS = {
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
} as const;

export function allowedTools(state: SessionState, verified: boolean, narrow?: Record<string, unknown>): ToolName[] {
  let list = [...(TOOLS_BY_STATE[state] ?? [])];
  const cfgList = narrow?.[state];
  if (Array.isArray(cfgList)) list = list.filter((t) => (cfgList as unknown[]).includes(t)); // narrowing only
  if (!verified) list = list.filter((t) => UNVERIFIED_TOOLS.includes(t));
  return list;
}

export const isToolName = (s: unknown): s is ToolName => typeof s === 'string' && (TOOL_NAMES as readonly string[]).includes(s);
export const isState = (s: unknown): s is SessionState => typeof s === 'string' && (SESSION_STATES as readonly string[]).includes(s);
