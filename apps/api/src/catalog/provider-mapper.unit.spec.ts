import { canonicalSpecialty, mapProviderDto } from './provider-mapper';

describe('KXM-DS-02 specialty folding from Kiorly spellings', () => {
  it.each([['pediatrics', 'paediatrics'], ['Pediatrics', 'paediatrics'], ['orthopedics', 'orthopaedics'], ['Obstetrics and Gynecology', 'obgyn'], ['OBSTETRICS_GYNECOLOGY', 'obgyn'], ['PHYSIO_THERAPY', 'physiotherapy'], ['Physical Therapy', 'physiotherapy'], ['cardiology', 'cardiology'], ['', null]])(
    '%s -> %s', (raw, expected) => expect(canonicalSpecialty(raw)).toBe(expected),
  );
  it('maps a Kiorly "pediatrics" listing so a paediatrics search finds it', () => {
    const row = mapProviderDto({ listingId: 'l1', clinicId: 'c1', clinicianId: 'd1', status: 'LIVE', provider: { nameEn: 'Dr Mona Fahmy', specialty: 'pediatrics' }, clinic: {} });
    expect(row.specialty).toBe('paediatrics');
  });
});
