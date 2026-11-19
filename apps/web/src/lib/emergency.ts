/** Emergency keyword routing (KXMDS06 / KX-16 H07). Matching is local; the query is never sent or logged. */
export const EMERGENCY_NUMBER = "123";

const PATTERNS: RegExp[] = [
  /chest\s*pain/i, /can'?t\s*breathe|cannot\s*breathe|difficulty\s*breathing|shortness\s*of\s*breath/i,
  /heart\s*attack|stroke|seizure|unconscious|faint(ed|ing)?/i, /severe\s*bleeding|bleeding\s*heavily/i,
  /overdose|poison(ed|ing)?/i, /suicid|kill\s*myself|self[-\s]*harm/i, /ambulance|emergency/i,
  /ألم\s*(في\s*)?(ال)?صدر/, /لا\s*أستطيع\s*التنفس|ضيق\s*(في\s*)?(ال)?تنفس|صعوبة\s*(في\s*)?(ال)?تنفس/,
  /جلطة|سكتة|تشنج|إغماء|اغماء|فقدان\s*الوعي/, /نزيف\s*(شديد|حاد)/, /تسمم|جرعة\s*زائدة/, /انتحار|أريد\s*أن\s*أموت/, /إسعاف|اسعاف|طوارئ/,
];

export const isEmergencyQuery = (q: string) => PATTERNS.some((p) => p.test(q));
