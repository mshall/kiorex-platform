/**
 * COM-3: how Pay's payout run reaches the funds-flow counsel gate of the commissions module (neither imports the other). In REAL mode a deposit may be paid out only through a payout / settlement route
 * counsel approved for the organisation's market; the port answers with a reason code when it may not (mock mode and "no port registered" = nothing is blocked, as before).
 */
export const PAYOUT_ROUTE_GATE_PORT = 'PAYOUT_ROUTE_GATE_PORT';
export interface PayoutRouteGatePort {
  /** Reason code when a deposit paid through `psp` must NOT be paid out for this organisation now, else null. */
  blockedReason(orgRef: string, psp: string): Promise<string | null>;
}
