/**
 * Notification templates (KXM-NT-01..03). WhatsApp template ids are placeholders: Meta approval and final copy
 * are NEEDS_HUMAN (see Docs/NEEDS_HUMAN.md). In-app copy is a draft for AR/EN review.
 */
export type NotifyKind = 'BOOKING_CONFIRMED' | 'BOOKING_PENDING_CLINIC' | 'BOOKING_CHANGED' | 'BOOKING_CANCELLED' | 'BOOKING_CANCELLED_BY_CLINIC' | 'REMINDER_24H' | 'REMINDER_2H' | 'REVIEW_INVITATION' | 'DEPOSIT_REFUNDED' | 'BOOKING_EXPIRED';

export interface Template { templateId: string; reminder: boolean; bypassQuiet?: boolean; en: string; ar: string }

export const TEMPLATES: Record<NotifyKind, Template> = {
  BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', reminder: false, en: 'Your visit with {doctor} is confirmed for {time}.', ar: 'تم تأكيد زيارتك مع {doctor} في {time}.' },
  BOOKING_PENDING_CLINIC: { templateId: 'TODO_NEEDS_HUMAN_booking_pending', reminder: false, en: 'Your request with {doctor} is awaiting clinic confirmation.', ar: 'طلبك مع {doctor} في انتظار تأكيد العيادة.' },
  BOOKING_CHANGED: { templateId: 'TODO_NEEDS_HUMAN_booking_changed', reminder: false, en: 'Your visit with {doctor} moved to {time}.', ar: 'تم تغيير موعدك مع {doctor} إلى {time}.' },
  BOOKING_CANCELLED: { templateId: 'TODO_NEEDS_HUMAN_booking_cancelled', reminder: false, en: 'Your visit with {doctor} was cancelled.', ar: 'تم إلغاء زيارتك مع {doctor}.' },
  BOOKING_CANCELLED_BY_CLINIC: { templateId: 'TODO_NEEDS_HUMAN_booking_cancelled_clinic', reminder: false, bypassQuiet: true, en: 'The clinic cancelled your visit with {doctor}. Any deposit is refunded automatically. Alternatives: {alternatives}', ar: 'ألغت العيادة زيارتك مع {doctor}. يُرد أي عربون تلقائيًا. بدائل: {alternatives}' },
  BOOKING_EXPIRED: { templateId: 'TODO_NEEDS_HUMAN_booking_expired', reminder: false, en: 'Your booking request with {doctor} expired.', ar: 'انتهت صلاحية طلب الحجز مع {doctor}.' },
  REMINDER_24H: { templateId: 'TODO_NEEDS_HUMAN_reminder_24h', reminder: true, en: 'Reminder: visit with {doctor} tomorrow at {time}.', ar: 'تذكير: زيارتك مع {doctor} غدًا في {time}.' },
  REMINDER_2H: { templateId: 'TODO_NEEDS_HUMAN_reminder_2h', reminder: true, en: 'Reminder: visit with {doctor} in 2 hours ({time}).', ar: 'تذكير: زيارتك مع {doctor} بعد ساعتين ({time}).' },
  REVIEW_INVITATION: { templateId: 'TODO_NEEDS_HUMAN_review_invite', reminder: true, en: 'How was your visit with {doctor}? Leave a review.', ar: 'كيف كانت زيارتك مع {doctor}؟ اترك تقييمًا.' },
  DEPOSIT_REFUNDED: { templateId: 'TODO_NEEDS_HUMAN_deposit_refunded', reminder: false, en: 'Your deposit was refunded.', ar: 'تم رد العربون.' },
};

export const render = (t: string, p: Record<string, unknown> = {}) => t.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
