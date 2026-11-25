/**
 * COM-1 role matrix for the commission console (platform side). Commission figures are money, so they follow the finance rule of the growth console:
 *   super_admin  everything: reads, exports, runs, config (maker AND checker, never both on one change), provider choice on behalf of an organisation
 *   finance      reads every organisation's ledger, collections, payouts, aging, disputes and reconciliation, exports (audited), triggers runs / retries, records invoice payments; no config
 *   ops_admin    NO money view (the console shows the page as not allowed); support / growth_admin likewise
 * One table so the controller, the console capability endpoint and the tests cannot disagree. A new role is one line here.
 */
export const COMMISSION_CAPABILITIES = ['read', 'export', 'operate', 'proposeConfig', 'approveConfig', 'chooseProvider', 'proposeRate', 'approveRate'] as const;
export type CommissionCapability = (typeof COMMISSION_CAPABILITIES)[number];
export const COMMISSION_ACCESS: Record<CommissionCapability, readonly string[]> = {
  read: ['super_admin', 'finance'],
  export: ['super_admin', 'finance'],
  operate: ['super_admin', 'finance'],
  proposeConfig: ['super_admin'],
  approveConfig: ['super_admin'],
  chooseProvider: ['super_admin'],
  /** COM-2 rates (default per organisation type and per-organisation override): maker AND checker are super admins, never the same person on one change. */
  proposeRate: ['super_admin'],
  approveRate: ['super_admin'],
};
export const commissionRolesFor = (cap: CommissionCapability): string[] => [...COMMISSION_ACCESS[cap]];
export const canCommission = (roles: readonly string[], cap: CommissionCapability): boolean => roles.some((r) => COMMISSION_ACCESS[cap].includes(r));
export const commissionCapabilitiesOf = (roles: readonly string[]): Record<CommissionCapability, boolean> => Object.fromEntries(COMMISSION_CAPABILITIES.map((c) => [c, canCommission(roles, c)])) as Record<CommissionCapability, boolean>;
