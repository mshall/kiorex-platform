import { normalizeText } from './text';

/**
 * Emergency keyword routing (KXM-DS-06, KX-16 hazard H07). This is a SAFETY CONTROL, never a feature flag (ADR-025).
 * NEEDS_HUMAN: CMO must approve the keyword list and the guidance copy before public launch.
 */
export const EMERGENCY_NUMBER = '123';

const TERMS: Record<string, string[]> = {
  CHEST_PAIN: ['chest pain', 'heart attack', 'crushing chest', 'الم في الصدر', 'الم الصدر', 'نوبه قلبيه', 'جلطه في القلب'],
  BREATHING: ['cant breathe', "can't breathe", 'cannot breathe', 'difficulty breathing', 'shortness of breath', 'choking', 'ضيق في التنفس', 'ضيق تنفس', 'مش قادر اتنفس', 'اختناق'],
  STROKE: ['stroke', 'face drooping', 'slurred speech', 'سكته دماغيه', 'جلطه في المخ', 'شلل مفاجئ'],
  CONSCIOUSNESS: ['unconscious', 'passed out', 'not responding', 'فقدان الوعي', 'اغماء', 'مغمي عليه', 'فاقد الوعي'],
  BLEEDING: ['severe bleeding', 'bleeding heavily', 'cant stop bleeding', 'نزيف شديد', 'نزيف حاد'],
  SEIZURE: ['seizure', 'convulsion', 'تشنجات', 'نوبه صرع'],
  POISONING: ['overdose', 'poisoning', 'swallowed poison', 'تسمم', 'جرعه زايده'],
  SELF_HARM: ['suicide', 'kill myself', 'want to die', 'انتحار', 'اقتل نفسي', 'عايز اموت'],
  ANAPHYLAXIS: ['anaphylaxis', 'throat swelling', 'severe allergic reaction', 'حساسيه شديده', 'تورم الحلق'],
};

const NORMALIZED = Object.entries(TERMS).map(([code, list]) => [code, list.map(normalizeText)] as const);

export interface EmergencyResult {
  emergency: boolean;
  /** Category codes only — the matched text is never returned or logged (no symptom data in analytics). */
  categories: string[];
}

export function detectEmergency(text: string | undefined | null): EmergencyResult {
  if (!text) return { emergency: false, categories: [] };
  const n = ` ${normalizeText(text).replace(/[.,!?؟،]/g, ' ').replace(/\s+/g, ' ')} `;
  const categories = NORMALIZED.filter(([, list]) => list.some((t) => n.includes(` ${t.replace(/[.,!?؟،]/g, ' ')} `) || n.includes(t))).map(([c]) => c);
  return { emergency: categories.length > 0, categories };
}

/** NEEDS_HUMAN: wording to be approved by CMO (KX-16 §02). The number 123 itself is fixed by KXM-DS-06. */
export const EMERGENCY_GUIDANCE = {
  number: EMERGENCY_NUMBER,
  service: 'ambulance',
  messageEn: 'NEEDS_HUMAN_APPROVAL: This may be an emergency. Call 123 (ambulance) now. Booking is not available for emergencies.',
  messageAr: 'NEEDS_HUMAN_APPROVAL: قد تكون هذه حالة طارئة. اتصل بالرقم 123 (الإسعاف) الآن. الحجز غير متاح للحالات الطارئة.',
  bookingBlocked: true,
};
