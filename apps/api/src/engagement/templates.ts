/**
 * Notification templates (KXM-NT-01..03). WhatsApp template ids are placeholders: Meta approval and final copy
 * are NEEDS_HUMAN (see Docs/NEEDS_HUMAN.md). In-app copy is a draft for AR/EN review.
 */
import { GROWTH_TEMPLATES, type GrowthKind } from './templates.growth';
import type { MessageClass } from './message-class';

export type BaseNotifyKind = 'BOOKING_CONFIRMED' | 'BOOKING_PENDING_CLINIC' | 'BOOKING_CHANGED' | 'BOOKING_CANCELLED' | 'BOOKING_CANCELLED_BY_CLINIC' | 'REMINDER_24H' | 'REMINDER_2H' | 'REVIEW_INVITATION' | 'DEPOSIT_REFUNDED' | 'BOOKING_EXPIRED'
  | 'HOME_VISIT_ASSIGNED' | 'HOME_VISIT_EN_ROUTE' | 'HOME_VISIT_ABORTED' | 'HOME_VISIT_FAMILY_INVITE' | 'HOME_VISIT_FAMILY_UPDATE' | 'CARE_PLAN_CONFIRMED'
  | 'WAITLIST_OFFER' | 'FOLLOW_UP_DUE' | 'RECORD_SHARED' | 'PHARMACY_ORDER_READY' | 'PHARMACY_ORDER_OUT_FOR_DELIVERY' | 'PHARMACY_ORDER_PARTIAL_REFUND' | 'PHARMACY_ORDER_DISPENSED' | 'PHARMACY_ORDER_REJECTED' | 'LAB_BOOKING_CONFIRMED' | 'LAB_RESULT_RELEASED' | 'TELE_SESSION_READY' | 'OPS_LEAD_ALERT';
/** Base kinds plus the lifecycle kinds of templates.growth.ts (GRW-P2-E, merged by the engagement owner). */
export type NotifyKind = BaseNotifyKind | GrowthKind;

/** `marketing: true` binds the template to the MARKETING purpose (per-channel consent, suppression, quiet hours, frequency caps, growth.marketing_messaging). No shipped template is marketing yet: copy and licence are NEEDS_HUMAN. */
export interface Template { templateId: string; reminder: boolean; marketing?: boolean; bypassQuiet?: boolean; en: string; ar: string; messageClass?: MessageClass; promotional?: boolean; copyReview?: 'PENDING' | 'APPROVED' }

const BASE_TEMPLATES: Record<BaseNotifyKind, Template> = {
  BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_booking_confirmed', reminder: false, en: 'Your visit with {doctor} is confirmed for {time}.', ar: 'تم تأكيد زيارتك مع {doctor} في {time}.' },
  BOOKING_PENDING_CLINIC: { templateId: 'TODO_NEEDS_HUMAN_booking_pending', reminder: false, en: 'Your request with {doctor} is awaiting clinic confirmation.', ar: 'طلبك مع {doctor} في انتظار تأكيد العيادة.' },
  BOOKING_CHANGED: { templateId: 'TODO_NEEDS_HUMAN_booking_changed', reminder: false, en: 'Your visit with {doctor} moved to {time}.', ar: 'تم تغيير موعدك مع {doctor} إلى {time}.' },
  BOOKING_CANCELLED: { templateId: 'TODO_NEEDS_HUMAN_booking_cancelled', reminder: false, en: 'Your visit with {doctor} was cancelled.', ar: 'تم إلغاء زيارتك مع {doctor}.' },
  BOOKING_CANCELLED_BY_CLINIC: { templateId: 'TODO_NEEDS_HUMAN_booking_cancelled_clinic', reminder: false, bypassQuiet: true, en: 'The clinic cancelled your visit with {doctor}. Any deposit is refunded automatically. Alternatives: {alternatives}', ar: 'ألغت العيادة زيارتك مع {doctor}. يُرد أي عربون تلقائيًا. بدائل: {alternatives}' },
  BOOKING_EXPIRED: { templateId: 'TODO_NEEDS_HUMAN_booking_expired', reminder: false, en: 'Your booking request with {doctor} expired.', ar: 'انتهت صلاحية طلب الحجز مع {doctor}.' },
  REMINDER_24H: { templateId: 'TODO_NEEDS_HUMAN_reminder_24h', reminder: true, en: 'Reminder: visit with {doctor} tomorrow at {time}.', ar: 'تذكير: زيارتك مع {doctor} غدًا في {time}.' },
  REMINDER_2H: { templateId: 'TODO_NEEDS_HUMAN_reminder_2h', reminder: true, en: 'Reminder: visit with {doctor} in 2 hours ({time}).', ar: 'تذكير: زيارتك مع {doctor} بعد ساعتين ({time}).' },
  REVIEW_INVITATION: { templateId: 'TODO_NEEDS_HUMAN_review_invite', reminder: true, en: 'How was your visit with {doctor}? Leave a review.', ar: 'كيف كانت زيارتك مع {doctor}؟ اترك تقييمًا.' },
  WAITLIST_OFFER: { templateId: 'TODO_NEEDS_HUMAN_waitlist_offer', reminder: false, en: 'A slot opened with {doctor} at {time}. Open Kiorex to take it before {until}.', ar: 'توفر موعد مع {doctor} في {time}. افتح كيوريكس لحجزه قبل {until}.' },
  FOLLOW_UP_DUE: { templateId: 'TODO_NEEDS_HUMAN_follow_up_due', reminder: true, en: 'Time for your follow-up visit. Open Kiorex to book.', ar: 'حان موعد زيارة المتابعة. افتح كيوريكس للحجز.' },
  RECORD_SHARED: { templateId: 'TODO_NEEDS_HUMAN_record_shared', reminder: false, en: 'A new record from your clinic is in your Kiorex vault.', ar: 'وصل سجل جديد من عيادتك إلى خزنتك في كيوريكس.' },
  PHARMACY_ORDER_READY: { templateId: 'TODO_NEEDS_HUMAN_pharmacy_order_ready', reminder: false, en: 'Your pharmacy order is ready.', ar: 'طلبك من الصيدلية جاهز.' },
  PHARMACY_ORDER_OUT_FOR_DELIVERY: { templateId: 'TODO_NEEDS_HUMAN_pharmacy_order_out_for_delivery', reminder: false, en: 'Your pharmacy order is out for delivery.', ar: 'طلبك من الصيدلية في الطريق إليك.' },
  PHARMACY_ORDER_PARTIAL_REFUND: { templateId: 'TODO_NEEDS_HUMAN_pharmacy_order_partial_refund', reminder: false, bypassQuiet: true, en: 'The pharmacy could fill only part of your order. {amount} is refunded automatically; open the order for the itemised refund.', ar: 'تمكنت الصيدلية من تجهيز جزء من طلبك فقط. يُرد {amount} تلقائيًا؛ افتح الطلب لترى الرد مفصّلًا.' },
  PHARMACY_ORDER_DISPENSED: { templateId: 'TODO_NEEDS_HUMAN_pharmacy_order_dispensed', reminder: false, en: 'Your pharmacy order was handed over.', ar: 'تم تسليم طلبك من الصيدلية.' },
  PHARMACY_ORDER_REJECTED: { templateId: 'TODO_NEEDS_HUMAN_pharmacy_order_rejected', reminder: false, bypassQuiet: true, en: 'The pharmacy could not fulfil your order. You are refunded automatically.', ar: 'تعذر على الصيدلية تنفيذ طلبك. يُرد المبلغ تلقائيًا.' },
  LAB_BOOKING_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_lab_booking_confirmed', reminder: false, en: 'Your lab booking is confirmed for {time}.', ar: 'تم تأكيد حجز التحاليل في {time}.' },
  LAB_RESULT_RELEASED: { templateId: 'TODO_NEEDS_HUMAN_lab_result_released', reminder: false, en: 'Your lab report is ready in your Kiorex vault.', ar: 'تقرير التحاليل جاهز في خزنتك في كيوريكس.' },
  TELE_SESSION_READY: { templateId: 'TODO_NEEDS_HUMAN_tele_session_ready', reminder: false, en: 'Your video visit with {doctor} is ready to join.', ar: 'زيارتك بالفيديو مع {doctor} جاهزة للانضمام.' },
  // Rev 2.3 home visits (KXMNT01 "on the way", KXMHV05/07). Copy is a draft for AR/EN review; Meta template ids are placeholders (NEEDS_HUMAN, Docs/NEEDS_HUMAN.md "Provider go-live").
  HOME_VISIT_ASSIGNED: { templateId: 'TODO_NEEDS_HUMAN_home_visit_assigned', reminder: false, en: '{assignee} will visit you for your booking with {doctor}. Open Kiorex to see their photo and badge before they arrive.', ar: 'سيزورك {assignee} في حجزك مع {doctor}. افتح كيوريكس لترى صورته وشارته قبل وصوله.' },
  HOME_VISIT_EN_ROUTE: { templateId: 'TODO_NEEDS_HUMAN_home_visit_en_route', reminder: false, bypassQuiet: true, en: 'Your visit with {doctor} is on the way. {minutes} min (estimate).', ar: 'زيارتك مع {doctor} في الطريق إليك. حوالي {minutes} دقيقة (تقدير).' },
  HOME_VISIT_ABORTED: { templateId: 'TODO_NEEDS_HUMAN_home_visit_aborted', reminder: false, bypassQuiet: true, en: 'Your home visit with {doctor} was stopped for safety reasons. This is not a no-show and you are not charged for it. Our team will contact you about any deposit.', ar: 'تم إيقاف زيارتك المنزلية مع {doctor} لأسباب تتعلق بالسلامة. لا يُحتسب ذلك عدم حضور ولن تُحاسَب عليه. سيتواصل معك فريقنا بخصوص أي عربون.' },
  HOME_VISIT_FAMILY_INVITE: { templateId: 'TODO_NEEDS_HUMAN_home_visit_family_invite', reminder: false, bypassQuiet: true, en: '{patient} shared a home-visit status with you. Follow it here: {link} (reply STOP to stop).', ar: 'شاركك {patient} حالة زيارة منزلية. تابعها من هنا: {link} (أرسل STOP للإيقاف).' },
  HOME_VISIT_FAMILY_UPDATE: { templateId: 'TODO_NEEDS_HUMAN_home_visit_family_update', reminder: false, bypassQuiet: true, en: 'Visit update for {patient}: {status}. {link}', ar: 'تحديث الزيارة لـ {patient}: {status}. {link}' },
  CARE_PLAN_CONFIRMED: { templateId: 'TODO_NEEDS_HUMAN_care_plan_confirmed', reminder: false, en: 'Your care plan with {doctor} is confirmed: {count} visits scheduled.', ar: 'تم تأكيد خطة الرعاية مع {doctor}: {count} زيارات مجدولة.' },
  // Kiorex team alert (no patient data): a partner organisation asked to talk. Copy is a draft for AR/EN review; the Meta template id is a placeholder (NEEDS_HUMAN).
  OPS_LEAD_ALERT: { templateId: 'TODO_NEEDS_HUMAN_ops_lead_alert', reminder: false, en: 'New Kiorex partner lead: {org} ({kindLabel}). Open Ops > Partner leads.', ar: 'عميل شريك جديد على كيوريكس: {org} ({kindLabel}). افتح العمليات > العملاء المحتملون.' },
  DEPOSIT_REFUNDED: { templateId: 'TODO_NEEDS_HUMAN_deposit_refunded', reminder: false, en: 'Your deposit was refunded.', ar: 'تم رد العربون.' },
};

/** The class of a template (AD-6): explicit when declared; otherwise marketing -> MARKETING, everything else shipped before the lifecycle package is a TRANSACTIONAL service message except the clinical ones named here. */
const CLINICAL_KINDS: ReadonlySet<string> = new Set(['LAB_RESULT_RELEASED', 'HOME_VISIT_ABORTED', 'RECORD_SHARED', 'FOLLOW_UP_DUE']);
export const TEMPLATES: Record<NotifyKind, Template> = { ...BASE_TEMPLATES, ...GROWTH_TEMPLATES };
export function messageClassOf(kind: string): MessageClass {
  const t = (TEMPLATES as Record<string, Template | undefined>)[kind];
  if (!t) return 'TRANSACTIONAL';
  if (t.messageClass) return t.messageClass;
  if (t.marketing) return 'MARKETING';
  return CLINICAL_KINDS.has(kind) ? 'CLINICAL' : 'TRANSACTIONAL';
}

export const render = (t: string, p: Record<string, unknown> = {}) => t.replace(/\{(\w+)\}/g, (_, k) => String(p[k] ?? ''));
