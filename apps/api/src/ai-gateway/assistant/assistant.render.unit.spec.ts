import { EMERGENCY_GUIDANCE } from '../../safety/safety-public';
import { R, reply, SHOWN_SPECIALTY_CODES } from './assistant.render';
import { scanOutbound } from './assistant.safety';
import type { Dialect } from './assistant.types';

const D: Dialect[] = ['en', 'eg', 'msa'];
const sample = (d: Dialect) => [
  R.disclosure(d), R.greet(d).body, R.askSpecialty(d, SHOWN_SPECIALTY_CODES).body, R.askSpecialty(d, SHOWN_SPECIALTY_CODES, 'symptom').body,
  R.providers(d, [{ name: 'Dr A', feeMinor: 30000, currency: 'EGP', nextSlotAt: '2030-01-01T10:00:00.000Z' }], { areaRelaxed: true }).body, R.noProviders(d).body,
  R.slots(d, 'Dr A', [{ startsAt: '2030-01-01T10:00:00.000Z' }]).body, R.noSlots(d, true).body, R.noSlots(d, false).body,
  R.confirmPrompt(d, { doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z', feeMinor: 30000, currency: 'EGP', depositMinor: 5000 }, 'CONFIRM:x:y', 'DECLINE:x:y').body,
  R.confirmed(d, { doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z', pendingClinic: false, link: 'https://kiorex.com/app/assistant?al=kxa1.t' }).body, R.confirmed(d, { doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z', pendingClinic: true }).body,
  R.declined(d).body, R.alreadyDone(d, 'x').body, R.invalidConfirm(d).body, R.useButtons(d).body, R.bookings(d, [{ doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z', status: 'CONFIRMED' }], 'cancel').body,
  R.noBookings(d).body, R.cancelPrompt(d, { doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z', depositMinor: 5000, currency: 'EGP', depositRefundable: true }, 'a', 'b').body, R.cancelPrompt(d, { doctor: 'Dr A', startsAt: '2030-01-01T10:00:00.000Z' }, 'a', 'b').body,
  R.cancelled(d).body, R.reschedulePrompt(d, { doctor: 'Dr A', oldStartsAt: '2030-01-01T10:00:00.000Z', newStartsAt: '2030-01-02T10:00:00.000Z' }, 'a', 'b').body, R.rescheduled(d, { doctor: 'Dr A', startsAt: '2030-01-02T10:00:00.000Z' }).body,
  R.waitlisted(d).body, R.waitlistUnavailable(d).body, R.link(d, 'https://kiorex.com/app/assistant?al=kxa1.t', 'VERIFY').body, R.handoff(d, 30).body, R.emergency(d).body, R.medicalRedirect(d).body, R.refuse(d).body,
  R.clarify(d, 'specialty').body, R.clarify(d, 'any').body, R.clarify(d, 'date').body, R.thanks(d).body, R.unverified(d).body, R.media(d).body, R.tooLong(d).body, R.rateLimited(d).body, R.slotTaken(d).body, R.busy(d).body, R.generic(d).body, R.holdExpired(d).body,
];

describe('GRW-P2-D renderer: fixed templates in three registers', () => {
  it.each(D)('%s: every template renders, is in the right script and the output scanner never blocks one of our own templates', (d) => {
    for (const body of sample(d)) {
      expect(body.length).toBeGreaterThan(5);
      expect({ d, body, blocked: scanOutbound(body, new Set(['https://kiorex.com/app/assistant?al=kxa1.t'])).blocked }).toEqual({ d, body, blocked: null });
      if (d === 'en') expect(body).not.toMatch(/[؀-ۿ]/); else expect(body).toMatch(/[؀-ۿ]/);
    }
  });
  it('the Egyptian and Modern Standard registers differ; the English one is plain', () => {
    expect(R.confirmPrompt('eg', { doctor: 'د', startsAt: '2030-01-01T10:00:00.000Z' }, 'a', 'b').body).toContain('اضغط تأكيد عشان تحجز'); expect(R.confirmPrompt('msa', { doctor: 'د', startsAt: '2030-01-01T10:00:00.000Z' }, 'a', 'b').body).toContain('اضغط تأكيد لإتمام الحجز');
    expect(R.providers('eg', [{ name: 'x' }]).body).toContain('اختار'); expect(R.providers('msa', [{ name: 'x' }]).body).toContain('اختر');
  });
  it('numbers, names, fees and times come from the arguments: nothing else is printed', () => {
    const b = R.confirmPrompt('en', { doctor: 'Dr Z', startsAt: '2030-01-01T10:00:00.000Z', feeMinor: 45050, currency: 'EGP', depositMinor: 9900 }, 'C', 'D');
    expect(b.body).toContain('Dr Z'); expect(b.body).toContain('450.5 EGP'); expect(b.body).toContain('99 EGP'); expect(b.buttons).toEqual([{ id: 'C', title: 'Confirm' }, { id: 'D', title: 'Cancel' }]);
    expect(R.confirmPrompt('en', { doctor: 'Dr Z', startsAt: '2030-01-01T10:00:00.000Z' }, 'C', 'D').body).not.toMatch(/fee|deposit/);
  });
  it('cancellation shows the refund consequence from the booking data: refundable, not refundable, unknown and none', () => {
    const t = (o: object) => R.cancelPrompt('en', { doctor: 'Dr Z', startsAt: '2030-01-01T10:00:00.000Z', ...o }, 'a', 'b').body;
    expect(t({ depositMinor: 5000, depositRefundable: true })).toContain('is refundable'); expect(t({ depositMinor: 5000, depositRefundable: false })).toContain('not refundable'); expect(t({ depositMinor: 5000, depositRefundable: null })).toContain('handled by the clinic cancellation policy'); expect(t({})).toContain('No deposit was paid');
  });
  it('the emergency text is the platform emergency guidance (123), unchanged', () => { expect(R.emergency('en').body).toBe(EMERGENCY_GUIDANCE.messageEn); expect(R.emergency('eg').body).toBe(EMERGENCY_GUIDANCE.messageAr); expect(R.emergency('en').body).toContain('NEEDS_HUMAN_APPROVAL'); });
  it('reply intents map to fixed text; an unknown intent is the generic clarify', () => {
    expect(reply('use_buttons', 'en').key).toBe('use_buttons'); expect(reply('symptom_choose_specialty', 'en').body).toContain('cannot assess symptoms'); expect(reply('cannot_help', 'en').key).toBe('clarify_any');
  });
  it('the disclosure names the assistant and the human option in all registers', () => { expect(R.disclosure('en')).toMatch(/automated assistant.*agent/); expect(R.disclosure('eg')).toContain('موظف'); expect(R.disclosure('msa')).toContain('موظف'); });
});
