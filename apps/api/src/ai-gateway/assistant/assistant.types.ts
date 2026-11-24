/**
 * GRW-P2-D shared types. The model port speaks ONLY in `ModelStep` (structured, never free text for the patient); everything the patient reads is rendered
 * from fixed templates with numbers, names and times taken from tool output.
 */
export type Lang = 'ar' | 'en';
/** Reply register for Arabic: Egyptian colloquial (eg) or Modern Standard (msa). English always `en`. */
export type Dialect = 'eg' | 'msa' | 'en';

export const SESSION_STATES = ['GREETING', 'UNDERSTAND', 'SEARCHING', 'PICKING', 'HOLDING', 'CONFIRMING', 'DONE', 'CANCEL_FLOW', 'RESCHEDULE_FLOW', 'HANDOFF', 'CLOSED'] as const;
export type SessionState = (typeof SESSION_STATES)[number];

export const TOOL_NAMES = ['search_providers', 'get_slots', 'get_next_available', 'hold_slot', 'prepare_confirmation', 'confirm_booking', 'get_my_bookings', 'reschedule_booking', 'cancel_booking', 'join_waitlist', 'create_booking_link', 'handoff_to_human', 'end_conversation'] as const;
export type ToolName = (typeof TOOL_NAMES)[number];

export const REPLY_INTENTS = ['greet', 'ask_specialty', 'symptom_choose_specialty', 'use_buttons', 'thanks', 'offer_help', 'cannot_help', 'medical_redirect', 'unverified_notice'] as const;
export type ReplyIntent = (typeof REPLY_INTENTS)[number];

export const CLARIFY_SLOTS = ['specialty', 'provider', 'slot', 'booking', 'date', 'any'] as const;
export type ClarifySlot = (typeof CLARIFY_SLOTS)[number];

export type ModelStep =
  | { kind: 'tool'; tool: ToolName; args: Record<string, unknown> }
  | { kind: 'reply_intent'; intent: ReplyIntent; slots?: Record<string, string | number | boolean> }
  | { kind: 'clarify'; slot: ClarifySlot }
  | { kind: 'handoff'; reason?: string };

export interface ShownLists {
  providers: { n: number; id: string; typeId: string }[];
  slots: { n: number; startsAt: string; endsAt: string }[];
  bookings: { n: number; id: string; status: string; providerId: string; typeId?: string }[];
  /** Specialty codes of the fixed choice list last shown (a number picked from it names the specialty). */
  specialties: string[];
  /** Which list the patient is looking at right now: a bare number refers to it. */
  lastList?: 'providers' | 'slots' | 'bookings' | 'specialties' | null;
  /** The provider whose slots are shown. */
  slotsProviderId?: string;
}
export interface ToolResult { tool: ToolName; ok: boolean; code?: string; data?: Record<string, any> }

/** What the model sees. `text` is already sanitised and PHI-redacted; ids come only from earlier tool results in this session. */
export interface ModelInput {
  text: string;
  lang: Lang;
  dialect: Dialect;
  state: SessionState;
  verified: boolean;
  shown: ShownLists;
  /** Tools the policy allows in this state: the model is told, but the orchestrator enforces. */
  allowedTools: readonly ToolName[];
  toolResults: ToolResult[];
  /** The specialty the patient chose earlier in this session (so "cheapest" refines the same search). */
  rememberedSpecialty?: string;
  /** A delimiter-wrapped copy for real models; the mock reads `text`. */
  prompt: { system: string; user: string };
  /** Market-local calendar date (yyyy-mm-dd) so a model can resolve "tomorrow" without a clock. */
  today: string;
  /** Tokens already spent in this session (synthetic in mock). */
  turn: number;
}
export interface AssistantModel {
  readonly name: string;
  readonly mode: 'mock' | 'fixture' | 'real';
  step(input: ModelInput): Promise<ModelStep>;
  /** Synthetic or real token usage of the last call, and money in minor units (0 in mock). */
  lastUsage?(): { tokensIn: number; tokensOut: number; costMinor: number };
}

export interface InboundText { phone: string; text?: string; buttonPayload?: string; logId?: string; /** The provider message id (Meta wamid): a webhook retry carries the same one. */ providerRef?: string }
export interface ConversationRef { id: string; phone: string; locale: string; sub: string | null; state: string }
export interface ProfileRef { sub: string; market: string; preferredLocale?: string | null }

export type RouteDecision = 'HANDLED' | 'DETERMINISTIC';

/** Per-session working memory (ids and counters only; never message text, names or contact details). */
export interface SessionContext {
  shown: ShownLists;
  idsSeen: string[]; // provider ids, slot start times and booking ids shown in this session
  specialty?: string; providerId?: string; typeId?: string; doctor?: string;
  pendingHold?: { bookingId: string; startsAt: string; doctor: string; expiresAt?: string };
  clarifyFails: number;
  /** Consecutive invalid model answers (one clarify, then the deterministic path). */
  invalidSteps?: number;
  lastInboundHash?: string; lastInboundAt?: number; lastProviderRef?: string;
  disclosed?: boolean;
  dialect?: Dialect;
  waitlistOffer?: { providerId: string; typeId: string };
  /** The booking a cancel or reschedule flow is about (owner-checked again when the tool runs). */
  target?: { kind: 'CANCEL' | 'RESCHEDULE'; bookingId: string; providerId?: string };
}
export const emptyContext = (): SessionContext => ({ shown: { providers: [], slots: [], bookings: [], specialties: [], lastList: null }, idsSeen: [], clarifyFails: 0 });
