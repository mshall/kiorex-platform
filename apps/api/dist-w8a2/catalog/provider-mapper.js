"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.normalizeDistrict = exports.SERVICE_LOCATIONS = exports.CARE_TYPES = exports.PROFESSIONS = void 0;
exports.careTypeOf = careTypeOf;
exports.canonicalSpecialty = canonicalSpecialty;
exports.mapProviderDto = mapProviderDto;
const district_1 = require("../common/district");
Object.defineProperty(exports, "normalizeDistrict", { enumerable: true, get: function () { return district_1.normalizeDistrict; } });
const safety_public_1 = require("../safety/safety-public");
const SPECIALTY_ALIASES = {
    pediatrics: 'paediatrics', pediatric: 'paediatrics', paediatric: 'paediatrics', paediatrician: 'paediatrics',
    gynecology: 'obgyn', gynaecology: 'obgyn', obstetrics_and_gynecology: 'obgyn', obstetrics_gynaecology: 'obgyn', obstetrics_gynecology: 'obgyn', ob_gyn: 'obgyn', obstetrics: 'obgyn',
    physio_therapy: 'physiotherapy', physio: 'physiotherapy', physical_therapy: 'physiotherapy', physiotherapist: 'physiotherapy',
    orthopedics: 'orthopaedics', orthopedic: 'orthopaedics', orthopaedic: 'orthopaedics',
    ear_nose_and_throat: 'ent', otolaryngology: 'ent', internal: 'internal_medicine', general_medicine: 'internal_medicine',
    dermatologist: 'dermatology', cardiologist: 'cardiology', dental: 'dentistry', dentist: 'dentistry',
};
exports.PROFESSIONS = ['PHYSICIAN', 'DENTIST', 'PHYSIOTHERAPIST', 'NURSE'];
exports.CARE_TYPES = ['DOCTORS', 'PHYSIOTHERAPY', 'HOME_NURSING'];
exports.SERVICE_LOCATIONS = ['IN_CLINIC', 'HOME'];
function careTypeOf(profession) {
    switch ((profession ?? '').toUpperCase()) {
        case 'PHYSIOTHERAPIST': return 'PHYSIOTHERAPY';
        case 'NURSE': return 'HOME_NURSING';
        default: return 'DOCTORS';
    }
}
function canonicalSpecialty(raw) {
    const sp = (0, safety_public_1.normalizeText)(raw).replace(/\s+/g, '_');
    if (!sp)
        return null;
    const aliased = SPECIALTY_ALIASES[sp] ?? sp;
    return aliased;
}
function mapProviderDto(dto) {
    const p = dto.provider ?? {};
    const c = dto.clinic ?? {};
    const fees = Array.isArray(p.fees) ? p.fees : [];
    const feeMinors = fees.map((f) => Math.round(Number(f.amount) * 100)).filter((n) => Number.isFinite(n));
    const specialtyRaw = String(p.specialty ?? c.clinicalSpecialty ?? '').trim();
    const specialty = canonicalSpecialty(specialtyRaw);
    const label = specialty && (0, safety_public_1.isSpecialtyCode)(specialty) ? safety_public_1.SPECIALTY_LABELS[specialty] : undefined;
    const area = p.area ?? c.area ?? null;
    const governorate = p.governorate ?? c.governorate ?? null;
    const professionRaw = String(dto.profession ?? p.profession ?? '').toUpperCase();
    const profession = exports.PROFESSIONS.includes(professionRaw) ? professionRaw : null;
    const locs = (Array.isArray(dto.serviceLocations) ? dto.serviceLocations : Array.isArray(p.serviceLocations) ? p.serviceLocations : []).map((x) => String(x).toUpperCase()).filter((x) => exports.SERVICE_LOCATIONS.includes(x));
    const serviceLocations = [...new Set(locs.length ? locs : ['IN_CLINIC'])];
    const coverageDistricts = [...new Set((Array.isArray(dto.coverageDistricts) ? dto.coverageDistricts : Array.isArray(p.coverageDistricts) ? p.coverageDistricts : []).map(district_1.normalizeDistrict).filter((x) => !!x))];
    const surcharges = fees.map((f) => (f.homeSurcharge === undefined || f.homeSurcharge === null ? NaN : Math.round(Number(f.homeSurcharge) * 100))).filter((n) => Number.isFinite(n));
    const row = {
        profession,
        edition: ['CLINIC', 'NURSE'].includes(String(dto.edition ?? '').toUpperCase()) ? String(dto.edition).toUpperCase() : null,
        careType: careTypeOf(profession),
        serviceLocations,
        coverageDistricts,
        assignsClinician: Boolean(dto.assignsClinician ?? p.assignsClinician),
        verificationRegister: (dto.verification?.register ?? p.verification?.register ?? null),
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
        languages: Array.isArray(p.languages) ? p.languages.map((x) => String(x).toLowerCase()) : [],
        gender: p.gender ? String(p.gender).toUpperCase() : null,
        governorate,
        area,
        latitude: c.latitude ?? null,
        longitude: c.longitude ?? null,
        minFeeMinor: feeMinors.length ? Math.min(...feeMinors) : null,
        maxFeeMinor: feeMinors.length ? Math.max(...feeMinors) : null,
        currency: fees[0]?.currency ?? 'EGP',
        acceptsDeposit: Boolean(p.acceptsDeposit ?? p.depositRequired ?? fees.some((f) => f.depositRequired || f.depositAmount)),
        raw: dto,
    };
    const searchText = (0, safety_public_1.normalizeText)([row.nameEn, row.nameAr, row.clinicNameEn, row.clinicNameAr, specialty, label?.en, label?.ar, ...row.subSpecialties, area, governorate, c.addressEn, c.addressAr, ...fees.flatMap((f) => [f.nameEn, f.nameAr])].filter(Boolean).join(' '));
    return { ...row, searchText };
}
//# sourceMappingURL=provider-mapper.js.map