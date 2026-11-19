import { isSpecialtyCode, normalizeText, SPECIALTY_LABELS } from '../safety/safety-public';

/** Kiorly stores free-text/US spellings; fold them onto the Kiorex launch specialty codes (KXM-DS-02 filter by specialty). */
const SPECIALTY_ALIASES: Record<string, string> = {
  pediatrics: 'paediatrics', pediatric: 'paediatrics', paediatric: 'paediatrics', paediatrician: 'paediatrics',
  gynecology: 'obgyn', gynaecology: 'obgyn', obstetrics_and_gynecology: 'obgyn', obstetrics_gynaecology: 'obgyn', ob_gyn: 'obgyn',
  orthopedics: 'orthopaedics', orthopedic: 'orthopaedics', orthopaedic: 'orthopaedics',
  ear_nose_and_throat: 'ent', otolaryngology: 'ent', internal: 'internal_medicine', general_medicine: 'internal_medicine',
  dermatologist: 'dermatology', cardiologist: 'cardiology', dental: 'dentistry', dentist: 'dentistry',
};
export function canonicalSpecialty(raw: string): string | null {
  const sp = normalizeText(raw).replace(/\s+/g, '_');
  if (!sp) return null;
  const aliased = SPECIALTY_ALIASES[sp] ?? sp;
  return aliased;
}

/** Map Kiorly PublishedProviderDto (GET /marketplace/v1/providers) into a Provider projection row. */
export function mapProviderDto(dto: any) {
  const p = dto.provider ?? {};
  const c = dto.clinic ?? {};
  const fees: { amount: number; currency?: string }[] = Array.isArray(p.fees) ? p.fees : [];
  const feeMinors = fees.map((f) => Math.round(Number(f.amount) * 100)).filter((n) => Number.isFinite(n));
  const specialtyRaw = String(p.specialty ?? c.clinicalSpecialty ?? '').trim();
  const specialty = canonicalSpecialty(specialtyRaw);
  const label = specialty && isSpecialtyCode(specialty) ? SPECIALTY_LABELS[specialty] : undefined;
  const area = p.area ?? c.area ?? null;
  const governorate = p.governorate ?? c.governorate ?? null;
  const row = {
    id: String(dto.listingId),
    tenantId: dto.tenantId ?? null,
    clinicId: String(dto.clinicId),
    clinicianId: String(dto.clinicianId),
    status: String(dto.status),
    sourceVersion: String(dto.updatedAt ?? ''),
    nameEn: p.displayNameEn ?? null,
    nameAr: p.displayNameAr ?? null,
    clinicNameEn: c.nameEn ?? null,
    clinicNameAr: c.nameAr ?? null,
    specialty,
    subSpecialties: Array.isArray(p.subSpecialties) ? p.subSpecialties.map(String) : [],
    languages: Array.isArray(p.languages) ? p.languages.map((x: string) => String(x).toLowerCase()) : [],
    gender: p.gender ? String(p.gender).toUpperCase() : null,
    governorate,
    area,
    latitude: c.latitude ?? null,
    longitude: c.longitude ?? null,
    minFeeMinor: feeMinors.length ? Math.min(...feeMinors) : null,
    maxFeeMinor: feeMinors.length ? Math.max(...feeMinors) : null,
    currency: fees[0]?.currency ?? 'EGP',
    acceptsDeposit: Boolean(p.acceptsDeposit ?? p.depositRequired ?? fees.some((f: any) => f.depositRequired || f.depositAmount)),
    raw: dto,
  };
  const searchText = normalizeText(
    [row.nameEn, row.nameAr, row.clinicNameEn, row.clinicNameAr, specialty, label?.en, label?.ar, ...row.subSpecialties, area, governorate, c.addressEn, c.addressAr].filter(Boolean).join(' '),
  );
  return { ...row, searchText };
}
