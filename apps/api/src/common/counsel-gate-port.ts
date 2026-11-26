/** COM-3: how the Integrations Control Center reads the funds-flow counsel gates of the commissions module (neither imports the other). No provider registered = no counsel block shown. */
export const COUNSEL_GATE_PORT = 'COUNSEL_GATE_PORT';
export interface CounselGatePort {
  state(market: string): Promise<{ market: string; counsel: { record: { status: string; reviewedOn: string } }; realBlocked: number; gates: { kind: string; key: string; allowed: boolean; reason: string; status: string }[] }>;
}
