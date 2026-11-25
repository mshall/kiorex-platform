/**
 * GRW-P1-K role matrix for the Growth admin API. The console has FOUR role claims today (ops users always carry `ops_admin`):
 *   super_admin  everything, including the maker side (draft, submit, rollback) and the checker side (approve, reject, activate) of config versions
 *   ops_admin    read everything that is not money; review nothing
 *   finance      `ops_admin` + `finance`: also reads the money views (financial performance, spend)
 *   support      `ops_admin` + `support`: also reviews fraud signals
 *   growth_admin (GRW-P2-S) reads the growth console and decides sponsored-promotion reviews (content, scope, high value); never writes configuration
 * One table, so the controllers, the UI capability endpoint and the tests cannot disagree. A new role is one line here.
 */
export const GROWTH_CAPABILITIES = ['read', 'readFinance', 'writeConfig', 'approveConfig', 'reviewFraud', 'manage', 'manageCampaigns', 'manageExperiments', 'reviewPromotions', 'manageCorporate', 'manageLoyalty'] as const;
export type GrowthCapability = (typeof GROWTH_CAPABILITIES)[number];

export const GROWTH_ACCESS: Record<GrowthCapability, readonly string[]> = {
  read: ['super_admin', 'ops_admin', 'finance', 'support', 'growth_admin'],
  readFinance: ['super_admin', 'finance'],
  writeConfig: ['super_admin'],
  approveConfig: ['super_admin'],
  reviewFraud: ['super_admin', 'support'],
  manage: ['super_admin'], // channels, widget registrations
  manageCampaigns: ['super_admin'], // GRW-P2-A: create, edit, transition, request and decide campaign approvals (two-person rule)
  reviewPromotions: ['super_admin', 'growth_admin'], // GRW-P2-S: decide sponsored-promotion reviews (the requester is the organisation; a high-value one needs a second approver)
  manageCorporate: ['super_admin'], // GRW-P4-C: corporate accounts, codes, HR lists, leads (terms and activation are a two-person act)
  manageLoyalty: ['super_admin'], // GRW-P4-D: partnership programs, codes and their activation (a second person activates); the points rules go through the maker-checker config console
  manageExperiments: ['super_admin'], // GRW-P3-A: create, submit, approve and start (two-person rule), stop, ship-winner request
};

export const rolesFor = (cap: GrowthCapability): string[] => [...GROWTH_ACCESS[cap]];
export const can = (roles: readonly string[], cap: GrowthCapability): boolean => roles.some((r) => GROWTH_ACCESS[cap].includes(r));
export const capabilitiesOf = (roles: readonly string[]): Record<GrowthCapability, boolean> => Object.fromEntries(GROWTH_CAPABILITIES.map((c) => [c, can(roles, c)])) as Record<GrowthCapability, boolean>;
