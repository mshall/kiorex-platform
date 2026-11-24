import { allowedTools, BUTTON_ONLY_TOOLS, LIMITS, SUBJECT_TOOLS, TOOLS_BY_STATE, UNVERIFIED_TOOLS } from './assistant.policy';
import { SESSION_STATES, TOOL_NAMES } from './assistant.types';

describe('GRW-P2-D policy table (state to allowed tools)', () => {
  it('has a row for every state and only known tools', () => {
    expect(Object.keys(TOOLS_BY_STATE).sort()).toEqual([...SESSION_STATES].sort());
    for (const list of Object.values(TOOLS_BY_STATE)) for (const t of list) expect(TOOL_NAMES).toContain(t);
  });
  it('confirm_booking exists only where a button can be pending (CONFIRMING and the cancel / reschedule flows); HOLDING prepares the buttons', () => {
    const where = SESSION_STATES.filter((s) => TOOLS_BY_STATE[s].includes('confirm_booking'));
    expect(where.sort()).toEqual(['CANCEL_FLOW', 'CONFIRMING', 'RESCHEDULE_FLOW']);
    expect(TOOLS_BY_STATE.HOLDING).toContain('prepare_confirmation');
    expect(BUTTON_ONLY_TOOLS).toEqual(['confirm_booking']);
  });
  it('a state with a human (HANDOFF) allows no tool at all', () => { expect(allowedTools('HANDOFF', true)).toEqual([]); });
  it('hold_slot needs a shown list (PICKING or HOLDING), never from GREETING', () => {
    expect(TOOLS_BY_STATE.GREETING).not.toContain('hold_slot'); expect(TOOLS_BY_STATE.PICKING).toContain('hold_slot'); expect(TOOLS_BY_STATE.UNDERSTAND).not.toContain('cancel_booking');
  });
  it('an unverified number gets search tools and the hand-off link only, in every state', () => {
    for (const s of SESSION_STATES) for (const t of allowedTools(s, false)) expect(UNVERIFIED_TOOLS).toContain(t);
    for (const t of SUBJECT_TOOLS) expect(UNVERIFIED_TOOLS).not.toContain(t);
  });
  it('ASSISTANT_POLICY can only narrow a state, never add a tool', () => {
    expect(allowedTools('PICKING', true, { PICKING: ['get_slots', 'cancel_booking_x'] })).toEqual(['get_slots']);
    expect(allowedTools('GREETING', true, { GREETING: ['hold_slot', 'confirm_booking'] })).toEqual([]);
  });
  it('limits: 4 tool steps, 30 day range, 5 minute hold, 15 minute link, 1000 characters', () => {
    expect(LIMITS).toMatchObject({ maxToolSteps: 4, maxDateRangeDays: 30, holdMinutes: 5, linkTtlMinutes: 15, maxInboundChars: 1000, sessionHours: 24 });
  });
});
