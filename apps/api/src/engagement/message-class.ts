/** The four message classes (AD-6). Exactly these; a template is bound to ONE class at definition time. */
export const MESSAGE_CLASSES = ['TRANSACTIONAL', 'SECURITY', 'CLINICAL', 'MARKETING'] as const;
export type MessageClass = (typeof MESSAGE_CLASSES)[number];
/** The notify-layer purpose a class maps to (the layer knows REMINDER, TRANSACTIONAL and MARKETING; SECURITY and CLINICAL are service messages on the TRANSACTIONAL consent). */
export type TemplatePurpose = 'TRANSACTIONAL' | 'REMINDER' | 'MARKETING';
