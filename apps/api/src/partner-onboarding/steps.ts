/**
 * Partner onboarding (ADR-040): pure step model. The ops console renders exactly what this returns, so the same function is unit tested.
 * AUTO steps run themselves (re-runnable, idempotent); HUMAN steps are highlighted as actionable items. Nothing here does I/O.
 */
export type ConnKind = 'CLINIC' | 'NURSE' | 'PHARMACY' | 'LAB';
export const CONN_KINDS: ConnKind[] = ['CLINIC', 'NURSE', 'PHARMACY', 'LAB'];
export type CheckStatus = 'PASSED' | 'FAILED' | 'WARN' | 'SKIPPED';
export interface CheckResult { status: CheckStatus; code: string; detail?: Record<string, unknown> }
export interface ChecksDoc { ranAt?: string; items?: Record<string, CheckResult> }

/** Human decisions recorded by ops (who/when only; no free text is ever logged). */
export interface HumanDoc {
  documents?: { by: string; at: string; note?: string };
  licence?: { by: string; at: string; reference: string };
  fees?: { by: string; at: string; mode: 'STANDARD' | 'ORG_OVERRIDE'; note?: string };
}
export type StepState = 'DONE' | 'FAILED' | 'WARN' | 'PENDING' | 'ACTION' | 'LOCKED';
export interface Step { key: string; type: 'AUTO' | 'HUMAN'; state: StepState; code?: string; detail?: Record<string, unknown>; /** HUMAN only: who may act */ actor?: 'ops_admin' | 'super_admin'; link?: string }

export const AUTO_STEPS = ['credentials', 'handshake', 'sync_dry_run', 'flags', 'market_pack', 'duplicates', 'documents'] as const;
export type AutoStep = (typeof AUTO_STEPS)[number];

/** Flags whose effective state the Go-live gate needs, per kind. Launch-locked ones need HUMAN gate evidence (never recorded here). */
export const KIND_FLAGS: Record<ConnKind, { key: string; launchLocked: boolean }[]> = {
  CLINIC: [{ key: 'kiorex.marketplace', launchLocked: false }, { key: 'clinic.kiorex_listing', launchLocked: false }],
  NURSE: [{ key: 'kiorex.marketplace', launchLocked: false }, { key: 'clinic.kiorex_listing', launchLocked: false }],
  PHARMACY: [{ key: 'kiorex.pharmacy_orders', launchLocked: true }, { key: 'pharmacy.kiorex_orders', launchLocked: false }],
  LAB: [{ key: 'kiorex.lab_bookings', launchLocked: true }, { key: 'lab.kiorex_bookings', launchLocked: false }],
};
export const needsHandshakeCreds = (k: ConnKind) => k === 'PHARMACY' || k === 'LAB';

export interface StepInput {
  kind: ConnKind; status: string; checks: ChecksDoc; human: HumanDoc; requestedBy?: string | null; approvedBy?: string | null; hasRegistration: boolean;
}

const autoFrom = (key: AutoStep, c: ChecksDoc): Step => {
  const r = c.items?.[key];
  if (!r) return { key, type: 'AUTO', state: 'PENDING' };
  const state: StepState = r.status === 'PASSED' || r.status === 'SKIPPED' ? 'DONE' : r.status === 'WARN' ? 'WARN' : 'FAILED';
  return { key, type: 'AUTO', state, code: r.code, detail: r.detail };
};

/** Flag-gate evidence is a HUMAN item exactly when a launch-locked flag is awaiting its gate. */
export function gateFlags(c: ChecksDoc): { flag: string; gateIds: string[]; satisfied: boolean }[] {
  return ((c.items?.flags?.detail?.gates ?? []) as { flag: string; gateIds: string[]; satisfied: boolean }[]);
}

export function computeSteps(i: StepInput): Step[] {
  const steps: Step[] = [];
  for (const k of AUTO_STEPS) steps.push(autoFrom(k, i.checks));
  const autoOk = steps.every((s) => s.state === 'DONE' || s.state === 'WARN');
  const humanState = (done: boolean): StepState => (done ? 'DONE' : 'ACTION');
  steps.push({ key: 'review_documents', type: 'HUMAN', actor: 'ops_admin', state: i.human.documents ? 'DONE' : i.checks.items?.documents?.status === 'PASSED' ? 'ACTION' : 'LOCKED', code: i.human.documents ? undefined : 'NEEDS_DOCUMENTS_CHECK' });
  steps.push({ key: 'verify_licence', type: 'HUMAN', actor: 'ops_admin', state: i.human.licence ? 'DONE' : 'ACTION' });
  steps.push({ key: 'fees', type: 'HUMAN', actor: 'ops_admin', state: humanState(!!i.human.fees), link: '/policy' });
  const gates = gateFlags(i.checks);
  if (gates.length) steps.push({ key: 'launch_gate', type: 'HUMAN', actor: 'super_admin', state: gates.every((g) => g.satisfied) ? 'DONE' : 'ACTION', link: '/flags', detail: { gates } });
  const humanDone = steps.filter((s) => s.type === 'HUMAN').every((s) => s.state === 'DONE');
  const st = i.status;
  const approved = ['APPROVED', 'LIVE', 'PAUSED'].includes(st);
  steps.push({ key: 'approval', type: 'HUMAN', actor: 'super_admin', state: approved ? 'DONE' : st === 'AWAITING_APPROVAL' ? 'ACTION' : autoOk && humanDone ? 'ACTION' : 'LOCKED', code: st === 'AWAITING_APPROVAL' ? 'AWAITING_SECOND_PERSON' : undefined, detail: { requestedBy: i.requestedBy ?? null, approvedBy: i.approvedBy ?? null } });
  steps.push({ key: 'go_live', type: 'HUMAN', actor: 'ops_admin', state: st === 'LIVE' ? 'DONE' : st === 'APPROVED' && autoOk && humanDone ? 'ACTION' : 'LOCKED' });
  return steps;
}

/** Progress = share of steps that are DONE (go_live counts, so 100 % means LIVE). */
export const progressPct = (steps: Step[]) => Math.round((steps.filter((s) => s.state === 'DONE' || s.state === 'WARN').length / steps.length) * 100);

/** Blocking reasons for Go live (empty = every gate green). Codes are stable; the console localises them. */
export function goLiveBlockers(i: StepInput): string[] {
  const steps = computeSteps(i);
  const out = steps.filter((s) => s.key !== 'go_live' && s.state !== 'DONE' && s.state !== 'WARN').map((s) => `STEP_${s.key.toUpperCase()}`);
  if (i.status !== 'APPROVED' && !out.includes('STEP_APPROVAL')) out.push('NOT_APPROVED');
  return out;
}
