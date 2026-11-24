import { toolJsonSchemas, toolSignatures, TOOL_SPECS, validateArgs } from './assistant.tools';
import { TOOL_NAMES } from './assistant.types';

describe('GRW-P2-D tool argument schemas and validators', () => {
  it('every tool has a JSON Schema generated from the same table the validator uses; no tool has an identity argument', () => {
    expect(toolJsonSchemas().map((s) => s.name)).toEqual([...TOOL_NAMES]);
    for (const n of TOOL_NAMES) for (const forbidden of ['sub', 'phone', 'tenantId', 'tenant', 'userId', 'patientId', 'email', 'clinicId']) expect(Object.keys(TOOL_SPECS[n].props)).not.toContain(forbidden);
    expect(toolSignatures()).toHaveLength(TOOL_NAMES.length);
  });
  it.each(['sub', 'phone', 'tenantId', 'patientId', 'email', 'userId'])('refuses a "%s" argument on every tool', (key) => {
    for (const n of TOOL_NAMES) expect(validateArgs(n, { [key]: 'x', ...(n === 'hold_slot' ? { providerId: 'p', startsAt: '2030-01-01T10:00:00.000Z' } : {}) })).toMatchObject({ ok: false, code: 'ARG_NOT_ALLOWED', key });
  });
  it('required, type, enum, pattern and range checks', () => {
    expect(validateArgs('hold_slot', { providerId: 'lst_1' })).toMatchObject({ ok: false, code: 'ARG_MISSING' });
    expect(validateArgs('hold_slot', { providerId: 'lst_1', startsAt: 'tomorrow' })).toMatchObject({ ok: false, code: 'ARG_INVALID', key: 'startsAt' });
    expect(validateArgs('hold_slot', { providerId: 'lst_1', startsAt: '2030-01-01T10:00:00.000Z' })).toMatchObject({ ok: true });
    expect(validateArgs('search_providers', { sortBy: 'rating' })).toMatchObject({ ok: false, code: 'ARG_INVALID' });
    expect(validateArgs('search_providers', { maxPriceMinor: -1 })).toMatchObject({ ok: false });
    expect(validateArgs('search_providers', { maxPriceMinor: 12.5 })).toMatchObject({ ok: false });
    expect(validateArgs('search_providers', { district: 'nasr city', sameDay: true, date: '2030-01-01' })).toMatchObject({ ok: true });
    expect(validateArgs('get_slots', { providerId: '../../etc/passwd' })).toMatchObject({ ok: false, code: 'ARG_INVALID' });
    expect(validateArgs('get_slots', { providerId: 'x'.repeat(65) })).toMatchObject({ ok: false });
    expect(validateArgs('create_booking_link', { intent: 'ADMIN' })).toMatchObject({ ok: false });
    expect(validateArgs('handoff_to_human', { reason: 'USER_REQUEST' })).toMatchObject({ ok: true });
    expect(validateArgs('confirm_booking', { holdId: 'x' })).toMatchObject({ ok: false, code: 'ARG_NOT_ALLOWED' }); // confirm takes nothing: the button payload is the argument
    expect(validateArgs('end_conversation', null)).toMatchObject({ ok: true });
    expect(validateArgs('end_conversation', [])).toMatchObject({ ok: false });
  });
  it('a very long string is refused whatever its declared max', () => { expect(validateArgs('get_slots', { providerId: 'a'.repeat(300) })).toMatchObject({ ok: false }); });
});
