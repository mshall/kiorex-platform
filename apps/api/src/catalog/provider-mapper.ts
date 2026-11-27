import { normalizeDistrict } from '../common/district';
import { isSpecialtyCode, normalizeText, SPECIALTY_LABELS } from '../safety/safety-public';

/** Kiorly stores free-text/US spellings; fold them onto the Kiorex launch specialty codes (KXM-DS-02 filter by specialty). */
const SPECIALTY_ALIASES: Record<string, string> = {
  pediatrics: 'paediatrics', pediatric: 'paediatrics', paediatric: 'paediatrics', paediatrician: 'paediatrics',
  gynecology: 'obgyn', gynaecology: 'obgyn', obstetrics_and_gynecology: 'obgyn', obstetrics_gynaecology: 'obgyn', obstetrics_gynecology: 'obgyn', ob_gyn: 'obgyn', obstetrics: 'obgyn',
  physio_therapy: 'physiotherapy', physio: 'physiotherapy', physical_therapy: 'physiotherapy', physiotherapist: 'physiotherapy',
  orthopedics: 'orthopaedics', orthopedic: 'orthopaedics', orthopaedic: 'orthopaedics',
  ear_nose_and_throat: 'ent', otolaryngology: 'ent', internal: 'internal_medicine', general_medicine: 'internal_medicine',
  dermatologist: 'dermatology', cardiologist: 'cardiology', dental: 'dentistry', dentist: 'dentistry',
};
export const PROFESSIONS = ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'] as const;
export type Profession = (typeof PROFESSIONS)[number];
export const CARE_TYPES = ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'] as const;
export type CareType = (typeof CARE_TYPES)[number];
export const SERVICE_LOCATIONS = ['IN_CLINIC', 'HOME'] as const;
export type ServiceLocation = (typeof SERVICE_LOCATIONS)[number];

/** KX-03 Rev 2.3 care types: Doctors · Physiotherapy · Home nursing. Legacy (profession-less) listings are doctors. */
export function careTypeOf(profession: string | null | undefined): CareType {
  switch ((profession ?? '').toUpperCase()) {
    case 'PHYSIOTHERAPIST': return 'PHYSIOTHERAPY';
    case 'NURSE': return 'HOME_NURSING';
    default: return 'DOCTORS';
  }
}
export { normalizeDistrict };

export function canonicalSpecialty(raw: string): string | null {
  const sp = normalizeText(raw).replace(/\s+/g, '_');
  if (!sp) return null;
  const aliased = SPECIALTY_ALIASES[sp] ?? sp;
  return aliased;
}

/**
 * Founder decision A (27 Nov 2026): the ISO country market an organisation belongs to for life, as published by its Clinic (additive `market` field). Only a two-letter
 * code counts; anything else (absent, malformed, hostile) is `undefined`, and the projection then keeps its existing market (or the default for a new row).
 */
export function publishedMarketOf(dto: any): string | undefined {
  const raw = dto?.market;
  if (typeof raw !== 'string') return undefined;
  const cc = raw.trim().toUpperCase();
  return /^[A-Z]{2}$/.test(cc) ? cc : undefined;
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
  const professionRaw = String(dto.profession ?? p.profession ?? '').toUpperCase();
  const profession = (PROFESSIONS as readonly string[]).includes(professionRaw) ? professionRaw : null;
  const locs: string[] = (Array.isArray(dto.serviceLocations) ? dto.serviceLocations : Array.isArray(p.serviceLocations) ? p.serviceLocations : []).map((x: unknown) => String(x).toUpperCase()).filter((x: string) => (SERVICE_LOCATIONS as readonly string[]).includes(x));
  const serviceLocations = [...new Set(locs.length ? locs : ['IN_CLINIC'])];
  const coverageDistricts = [...new Set((Array.isArray(dto.coverageDistricts) ? dto.coverageDistricts : Array.isArray(p.coverageDistricts) ? p.coverageDistricts : []).map(normalizeDistrict).filter((x: string | null): x is string => !!x))];
  const surcharges = fees.map((f: any) => (f.homeSurcharge === undefined || f.homeSurcharge === null ? NaN : Math.round(Number(f.homeSurcharge) * 100))).filter((n) => Number.isFinite(n));
  const market = publishedMarketOf(dto);
  const row = {
    ...(market ? { market } : {}),
    profession,
    edition: ['CLINIC', 'NURSE'].includes(String(dto.edition ?? '').toUpperCase()) ? String(dto.edition).toUpperCase() : null,
    careType: careTypeOf(profession),
    serviceLocations,
    coverageDistricts,
    assignsClinician: Boolean(dto.assignsClinician ?? p.assignsClinician),
    verificationRegister: (dto.verification?.register ?? p.verification?.register ?? null) as string | null,
    homeSurchargeMinor: surcharges.length ? Math.min(...surcharges) : null,
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
    // fee/service names are searchable so "injection" or "wound care" finds the home-nursing service (KXMDS02 nursing service type)
    [row.nameEn, row.nameAr, row.clinicNameEn, row.clinicNameAr, specialty, label?.en, label?.ar, ...row.subSpecialties, area, governorate, c.addressEn, c.addressAr, ...fees.flatMap((f: any) => [f.nameEn, f.nameAr])].filter(Boolean).join(' '),
  );
  return { ...row, searchText };
}
