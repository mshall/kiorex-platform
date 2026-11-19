import { isSpecialtyCode, normalizeText, SPECIALTY_LABELS } from '../safety/safety-public';

/** Map Kiorly PublishedProviderDto (GET /marketplace/v1/providers) into a Provider projection row. */
export function mapProviderDto(dto: any) {
  const p = dto.provider ?? {};
  const c = dto.clinic ?? {};
  const fees: { amount: number; currency?: string }[] = Array.isArray(p.fees) ? p.fees : [];
  const feeMinors = fees.map((f) => Math.round(Number(f.amount) * 100)).filter((n) => Number.isFinite(n));
  const specialtyRaw = String(p.specialty ?? c.clinicalSpecialty ?? '').trim();
  const sp = normalizeText(specialtyRaw).replace(/\s+/g, '_');
  const specialty = isSpecialtyCode(sp) ? sp : specialtyRaw ? sp : null;
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
