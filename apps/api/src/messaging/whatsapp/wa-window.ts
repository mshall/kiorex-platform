/**
 * WhatsApp customer-service window (Meta Cloud API). A business may send a FREE-FORM message (text, interactive buttons / list) only within 24 hours of the
 * customer's last INBOUND message; outside it only an APPROVED TEMPLATE may be sent (else Meta answers error 131047). The inbound time is stored per number
 * (keyed hash, never the raw number) by the webhook handler; this file is the pure decision and has no I/O. Time is always passed in (injected clock in tests).
 */
export const DEFAULT_WINDOW_HOURS = 24;

export interface WindowState { open: boolean; closesAtMs: number | null; remainingMs: number }
export function windowState(lastInboundMs: number | null | undefined, nowMs: number, windowHours = DEFAULT_WINDOW_HOURS): WindowState {
  if (!lastInboundMs || !Number.isFinite(lastInboundMs) || lastInboundMs > nowMs + 60_000) return { open: false, closesAtMs: null, remainingMs: 0 }; // a stamp from the future is rejected, never trusted
  const closesAtMs = lastInboundMs + windowHours * 3_600_000;
  return { open: nowMs < closesAtMs, closesAtMs, remainingMs: Math.max(0, closesAtMs - nowMs) };
}

export interface WaWindowStore {
  lastInboundMs(phone: string, market?: string): Promise<number | null>;
  /** Records an inbound at `atMs`; never moves the stamp backwards (a replayed old webhook cannot shrink the window). */
  touch(phone: string, atMs: number, market?: string): Promise<void>;
}
export class MemoryWaWindowStore implements WaWindowStore {
  private readonly m = new Map<string, number>();
  async lastInboundMs(phone: string, market = 'EG') { return this.m.get(`${market}|${phone}`) ?? null; }
  async touch(phone: string, atMs: number, market = 'EG') { const k = `${market}|${phone}`; if ((this.m.get(k) ?? 0) < atMs) this.m.set(k, atMs); }
}

export type WaSendMode = 'SESSION_TEXT' | 'SESSION_INTERACTIVE' | 'TEMPLATE' | 'TEMPLATE_QUICK_REPLY';
export type WaRefusal = 'WA_WINDOW_CLOSED' | 'WA_NO_TEMPLATE';
export interface WaDecisionInput {
  /** The message carries reply buttons or a list (the assistant's CONFIRM / CANCEL). */
  interactive: boolean;
  windowOpen: boolean;
  /** An approved template exists for this message (and, for interactive, one whose quick-reply count matches). */
  templateAvailable: boolean;
  templateQuickReplyFits: boolean;
  /** Conversational reply (assistant / booking state machine): prefer free-form inside the window. Notifications keep the pre-approved template wording. */
  conversational: boolean;
}
/**
 * The one decision table:
 *   interactive + window open            -> SESSION_INTERACTIVE (button payload round-trips in interactive.button_reply.id)
 *   interactive + window closed          -> TEMPLATE_QUICK_REPLY if a template with matching quick replies exists, else REFUSE WA_WINDOW_CLOSED
 *   plain + conversational + open        -> SESSION_TEXT
 *   plain + template available           -> TEMPLATE (also inside the window: approved wording, utility templates inside the window are free of charge)
 *   plain + no template + open           -> SESSION_TEXT
 *   plain + no template + closed         -> REFUSE (WA_WINDOW_CLOSED when it was a conversational reply, WA_NO_TEMPLATE otherwise)
 */
export function decideWhatsappSend(i: WaDecisionInput): { mode: WaSendMode } | { refuse: WaRefusal } {
  if (i.interactive) {
    if (i.windowOpen) return { mode: 'SESSION_INTERACTIVE' };
    return i.templateAvailable && i.templateQuickReplyFits ? { mode: 'TEMPLATE_QUICK_REPLY' } : { refuse: 'WA_WINDOW_CLOSED' };
  }
  if (i.conversational && i.windowOpen) return { mode: 'SESSION_TEXT' };
  if (i.templateAvailable) return { mode: 'TEMPLATE' };
  if (i.windowOpen) return { mode: 'SESSION_TEXT' };
  return { refuse: i.conversational ? 'WA_WINDOW_CLOSED' : 'WA_NO_TEMPLATE' };
}
