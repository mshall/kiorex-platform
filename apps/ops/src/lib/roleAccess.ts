/**
 * Console roles and what each may open (ADR-062). One table for the navigation, the route gate and the role dashboards. It mirrors what the API enforces; the API
 * stays the authority (a refused route answers 403 FORBIDDEN_ROLE, the console then shows the "no access" page), the table only keeps the UI from offering what a role cannot open.
 * `test/ops-role-matrix.int.spec.ts` in the API proves the Kiorly rows against the real route table.
 */
export type ConsoleRole = "super_admin" | "ops_admin" | "finance" | "growth_admin" | "kiorly_admin" | "kiorly_ops";
export const CONSOLE_ROLES: readonly ConsoleRole[] = ["super_admin", "ops_admin", "finance", "growth_admin", "kiorly_admin", "kiorly_ops"];
export const KIORLY_ONLY_ROLES: readonly string[] = ["kiorly_ops", "kiorly_admin"];
export const isConsoleRole = (r: string): r is ConsoleRole => (CONSOLE_ROLES as readonly string[]).includes(r);
export const hasConsoleRole = (roles: readonly string[]): boolean => roles.some(isConsoleRole);
/** A sign-in that holds Kiorly roles must hold nothing else (separate accounts); the API refuses a mixed token everywhere. */
export const isKiorlyOnly = (roles: readonly string[]): boolean => roles.some((r) => KIORLY_ONLY_ROLES.includes(r));
export const isMixed = (roles: readonly string[]): boolean => isKiorlyOnly(roles) && roles.some((r) => !KIORLY_ONLY_ROLES.includes(r));

/** Which dashboard a person lands on when they hold several roles: the first in this order (they can switch to the others they hold). */
export const DASHBOARD_PRIORITY: readonly ConsoleRole[] = ["super_admin", "ops_admin", "finance", "growth_admin", "kiorly_admin", "kiorly_ops"];
export const heldRoles = (roles: readonly string[]): ConsoleRole[] => DASHBOARD_PRIORITY.filter((r) => roles.includes(r));
export const dashboardRole = (roles: readonly string[], wanted?: string | null): ConsoleRole | null => {
  const held = heldRoles(roles);
  return (wanted && (held as string[]).includes(wanted) ? (wanted as ConsoleRole) : held[0]) ?? null;
};

const OPS: readonly string[] = ["ops_admin", "super_admin"];
const KIORLY: readonly string[] = KIORLY_ONLY_ROLES;
const MONEY: readonly string[] = ["super_admin", "finance"];
const ALL: readonly string[] = CONSOLE_ROLES;

/** Longest matching prefix wins. A path nobody lists is refused for every role (deny by default, like the API). */
const RULES: ReadonlyArray<readonly [string, readonly string[]]> = [
  ["/home", ALL],
  // Kiorly-side work: Kiorex ops and super admin and the two Kiorly roles
  ["/providers", [...OPS, ...KIORLY]], ["/leads", [...OPS, ...KIORLY]], ["/partner-leads", [...OPS, ...KIORLY]], ["/onboarding", [...OPS, ...KIORLY]], ["/partner-onboarding", [...OPS, ...KIORLY]],
  ["/fees", [...OPS, ...KIORLY]], ["/kiorly-markets", [...OPS, ...KIORLY]], ["/kiorly-plans", [...OPS, ...KIORLY]],
  ["/commission-policy", [...MONEY, ...KIORLY]], // the Kiorly roles read the policy and the rates only; maker and checker stay super_admin
  // money
  ["/commissions", MONEY], ["/pay-ops", MONEY],
  // Kiorex operations (ops_admin and super_admin only; refused for every other role by the API)
  ["/bookings", OPS], ["/outbox", OPS], ["/finance", OPS], ["/moderation", OPS], ["/liquidity", OPS], ["/messaging", OPS], ["/integrations", OPS], ["/orders", OPS], ["/policy", OPS],
  ["/operations", OPS], ["/safety", OPS], ["/held-deposits", OPS], ["/payments-connection", OPS], ["/reconciliation", OPS], ["/home-gate", OPS], ["/flags", OPS],
  ["/growth-analytics", OPS], ["/acquisition", OPS],
  // growth engine: read for ops, finance and growth_admin; the money views of it for finance and super admin
  ["/growth", ["super_admin", "ops_admin", "finance", "growth_admin"]], ["/growth/finance", MONEY], ["/growth/rewards/finance", MONEY],
];

export const rolesAllowedFor = (pathname: string): readonly string[] => {
  let best: readonly string[] = []; let bestLen = -1;
  for (const [prefix, roles] of RULES) if ((pathname === prefix || pathname.startsWith(`${prefix}/`)) && prefix.length > bestLen) { best = roles; bestLen = prefix.length; }
  return best;
};
export const canOpen = (roles: readonly string[], pathname: string): boolean => rolesAllowedFor(pathname).some((r) => roles.includes(r));
