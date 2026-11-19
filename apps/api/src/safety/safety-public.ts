export { detectEmergency, EMERGENCY_GUIDANCE, EMERGENCY_NUMBER } from './emergency';
export type { EmergencyResult } from './emergency';
export { mapSymptomToSpecialties, SPECIALTY_CODES, SPECIALTY_LABELS, isSpecialtyCode } from './symptoms';
export type { SpecialtyCode } from './symptoms';
export { detectPhi, redactPhi, detectAbuse } from './phi';
export type { PhiKind } from './phi';
export { normalizeText } from './text';
