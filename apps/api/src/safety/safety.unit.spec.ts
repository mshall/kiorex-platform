import { detectEmergency, detectPhi, EMERGENCY_GUIDANCE, isSpecialtyCode, mapSymptomToSpecialties, SPECIALTY_CODES, SPECIALTY_LABELS, normalizeText, redactPhi } from './safety-public';

describe('safety: emergency routing (KXM-DS-06, KX-16 H07)', () => {
  it.each([
    ['I have severe chest pain', 'CHEST_PAIN'], ["can't breathe", 'BREATHING'], ['my father had a stroke', 'STROKE'], ['she is unconscious', 'CONSCIOUSNESS'],
    ['severe bleeding after fall', 'BLEEDING'], ['seizure', 'SEIZURE'], ['overdose of pills', 'POISONING'], ['I want to die', 'SELF_HARM'],
    ['my father is not breathing', 'BREATHING'], ['the baby stopped breathing', 'BREATHING'], ['ابني مش قادر يتنفس', 'BREATHING'], ['توقف التنفس', 'BREATHING'], ['ألم شديد في الصدر', 'CHEST_PAIN'], ['عندي وجع في الصدر', 'CHEST_PAIN'], ['ألم في الصدر', 'CHEST_PAIN'], ['ضيق في التنفس', 'BREATHING'], ['فقدان الوعي', 'CONSCIOUSNESS'], ['نزيف شديد', 'BLEEDING'], ['عايز اموت', 'SELF_HARM'], ['إغماء', 'CONSCIOUSNESS'],
  ])('%s → emergency %s', (text, cat) => {
    const r = detectEmergency(text);
    expect(r.emergency).toBe(true);
    expect(r.categories).toContain(cat);
    expect(JSON.stringify(r)).not.toContain(text); // categories only, never the text
  });
  it.each(['dermatologist in Maadi', 'back pain', 'pediatrician for my son', 'طبيب جلدية', 'ألم في الظهر'])('%s → not an emergency', (t) => expect(detectEmergency(t).emergency).toBe(false));
  it('guidance names the ambulance number 123 and blocks booking; copy is flagged NEEDS_HUMAN', () => {
    expect(EMERGENCY_GUIDANCE.number).toBe('123');
    expect(EMERGENCY_GUIDANCE.bookingBlocked).toBe(true);
    expect(EMERGENCY_GUIDANCE.messageEn).toContain('NEEDS_HUMAN');
  });
  it('is robust to diacritics, alef/yaa variants and punctuation', () => {
    expect(normalizeText('أَلَم في الصَّدر')).toBe('الم في الصدر');
    expect(detectEmergency('الم   في   الصدر!!!').emergency).toBe(true);
  });
});

describe('safety: symptom keyword → specialty and PHI redaction', () => {
  it('maps keywords (EN/AR) to specialty codes', () => {
    expect(mapSymptomToSpecialties('skin rash')[0]).toBe('dermatology');
    expect(mapSymptomToSpecialties('طفلي عنده سخونية')[0]).toBe('paediatrics');
    expect(mapSymptomToSpecialties('toothache')[0]).toBe('dentistry');
    expect(mapSymptomToSpecialties('knee pain')[0]).toBe('orthopaedics');
    expect(mapSymptomToSpecialties('qqqq')).toEqual([]);
  });
  it('redacts phones, emails, national IDs, URLs and name claims before AI calls', () => {
    const r = redactPhi('I am Amira Samy, 01012345678, a@b.com, id ٢٩٠٠٤٠٢٠١٠١٢٣٤, see http://x.y/z');
    expect(r.text).not.toMatch(/Amira|01012345678|a@b\.com|29004020101234|http/);
    expect(r.count).toBeGreaterThanOrEqual(4);
    expect(detectPhi('call +20 100 123 4567')).toContain('PHONE');
  });
});

describe('specialty catalogue', () => {
  it('covers the full set, every code has EN+AR labels, and symptoms route to the new specialties', () => {
    expect(SPECIALTY_CODES.length).toBeGreaterThanOrEqual(30);
    for (const c of SPECIALTY_CODES) { expect(isSpecialtyCode(c)).toBe(true); expect(SPECIALTY_LABELS[c].en).toBeTruthy(); expect(SPECIALTY_LABELS[c].ar).toMatch(/[\u0600-\u06FF]/); }
    expect(mapSymptomToSpecialties('severe migraine headache')[0]).toBe('neurology');
    expect(mapSymptomToSpecialties('كحه وضيق تنفس')).toContain('pulmonology');
  });
  it('keeps the first six codes stable (WhatsApp quick list)', () => {
    expect(SPECIALTY_CODES.slice(0, 6)).toEqual(['dermatology', 'paediatrics', 'obgyn', 'orthopaedics', 'ent', 'internal_medicine']);
  });
});
