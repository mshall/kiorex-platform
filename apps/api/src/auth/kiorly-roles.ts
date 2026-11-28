import { RequestMethod } from '@nestjs/common';

/**
 * Kiorly-only roles (founder decision 28 Nov 2026, option A of `_docs/KIORLY_OPS_ROLE_SPLIT_DECISION.md`, ADR-062).
 *
 *   kiorly_ops    read, review and onboarding actions on Kiorly data (providers, join requests, partner onboarding), read of the Kiorly markets, plans and commission policy
 *   kiorly_admin  everything kiorly_ops may do plus changes within the Kiorly scope (assign and export join requests, partner go-live / pause, enrolment codes, verification decisions)
 *
 * DENY BY DEFAULT. A token carrying either role is refused on every route that is not in KIORLY_ALLOW, whatever `@Roles` says (the allow-list REPLACES the
 * `@Roles` check for these two roles; a route without any `@Roles` is refused for them too). A new route is therefore closed to them until it is listed here, and the
 * generated route-table test (`test/kiorly-roles.int.spec.ts`) proves it for every route of the application.
 *
 * Never allowed to these roles, on purpose: orders, finance, reconciliation, payments, messaging, integrations, flags, operations, outbox, bookings, moderation,
 * growth, anything with patient identifiers, the commission maker-checker flow (propose AND approve: super_admin only), Kiorly market launch and every price approval
 * (super_admin). The same sign-in must never hold both Kiorex and Kiorly roles: such a token is refused everywhere (`FORBIDDEN_MIXED_ROLES`).
 */
export const KIORLY_OPS_ROLE = 'kiorly_ops';
export const KIORLY_ADMIN_ROLE = 'kiorly_admin';
export const KIORLY_ROLES: readonly string[] = [KIORLY_OPS_ROLE, KIORLY_ADMIN_ROLE];
export const isKiorlyRole = (r: string): boolean => KIORLY_ROLES.includes(r);
export const hasKiorlyRole = (roles: readonly string[]): boolean => roles.some(isKiorlyRole);
/** A token that mixes a Kiorly role with any other role (a Kiorex role, `patient`, ...) is a configuration error and is refused. */
export const hasMixedRoles = (roles: readonly string[]): boolean => hasKiorlyRole(roles) && roles.some((r) => !isKiorlyRole(r));

export type KiorlyLevel = 'ops' | 'admin';
export interface KiorlyRoute { m: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE'; path: string; level: KiorlyLevel; note?: string }

const g = (path: string, level: KiorlyLevel = 'ops', note?: string): KiorlyRoute => ({ m: 'GET', path, level, note });
const p = (path: string, level: KiorlyLevel = 'ops', note?: string): KiorlyRoute => ({ m: 'POST', path, level, note });

/**
 * The explicit allow-list: method + route template WITHOUT the global prefix (`api/v1`), exactly as the controllers declare it (`<controller path>/<handler path>`).
 * level `ops` = kiorly_ops and kiorly_admin; level `admin` = kiorly_admin only. None of these routes returns a patient identifier.
 * ADD A ROUTE HERE ONLY AFTER CHECKING ITS RESPONSE FOR PATIENT IDENTIFIERS AND ITS EFFECT (money, flags and cross-product settings never belong here).
 * The plans maker-checker routes (propose a price: kiorly_ops and kiorly_admin may propose, never approve) are added by the plans work as soon as they exist.
 */
export const KIORLY_ALLOW: readonly KiorlyRoute[] = [
  g('auth/me', 'ops', 'who am I (claims only)'),
  // provider directory
  g('admin/providers'),
  // join requests from the Kiorly site (leads): review work for ops, bulk export for admin
  g('admin/leads'), g('admin/leads/summary'), g('admin/leads/owners'), g('admin/leads/settings'), g('admin/leads/:id'),
  { m: 'PATCH', path: 'admin/leads/:id', level: 'ops', note: 'status, owner, tags (isTest stays super_admin inside the service)' }, p('admin/leads/:id/notes'),
  g('admin/leads/export.csv', 'admin', 'decrypted contact details of many requests'),
  // partner leads ("Talk to us")
  g('admin/partner-leads'), g('admin/partner-leads/funnel'), g('admin/partner-leads/unread'), g('admin/partner-leads/alerts'), p('admin/partner-leads/seen'),
  { m: 'PATCH', path: 'admin/partner-leads/:id', level: 'ops' }, p('admin/partner-leads/:id/notes'),
  // onboarding: import batches are READ only (their task and patient lookup routes carry patient data and stay refused)
  g('admin/onboarding/imports'), g('admin/onboarding/imports/:id'), g('admin/onboarding/imports/:id/audit'),
  // partner onboarding (connection requests): checks and review for ops; reject, go-live, pause, resume, rotation for admin; approve stays super_admin
  g('admin/onboarding/partners'), g('admin/onboarding/partners/:id'), g('admin/onboarding/partners/:id/audit'),
  p('admin/onboarding/partners/:id/run-checks'), p('admin/onboarding/partners/:id/steps/review_documents'), p('admin/onboarding/partners/:id/steps/verify_licence'),
  p('admin/onboarding/partners/:id/steps/fees'), p('admin/onboarding/partners/:id/request-changes'), p('admin/onboarding/partners/:id/request-approval'),
  p('admin/onboarding/partners/:id/reject', 'admin'), p('admin/onboarding/partners/:id/go-live', 'admin'), p('admin/onboarding/partners/:id/pause', 'admin'),
  p('admin/onboarding/partners/:id/resume', 'admin'), p('admin/onboarding/partners/:id/apply-rotation', 'admin'),
  g('admin/onboarding/enrolments'), p('admin/onboarding/enrolments', 'admin'), { m: 'DELETE', path: 'admin/onboarding/enrolments/:id', level: 'admin' },
  g('admin/onboarding/verification-updates'), g('admin/onboarding/verification-updates/:ref'), p('admin/onboarding/verification-updates/:ref/decide', 'admin'),
  // commission policy and rates: READ only (maker and checker stay super_admin)
  g('admin/commissions/capabilities'), g('admin/commissions/policy'), g('admin/commissions/policy/:market'), g('admin/commissions/rates/defaults'), g('admin/commissions/rates/orgs/:orgRef'),
  // fee statement per partner (aggregates, no patient)
  g('admin/fee-statements'),
  // Kiorly markets: READ only (launch, pause, disable, tax pack and approvals stay super_admin)
  g('admin/kiorly-markets'), g('admin/kiorly-markets/country-defaults'), g('admin/kiorly-markets/:id'), g('admin/kiorly-markets/:id/audit'), g('admin/kiorly-markets/:id/change-requests'),
  // plans on the Kiorly landing page: READ (price proposals are added with the plans maker-checker)
  g('admin/kiorly-plans'),
];

const norm = (s: string): string => s.split('/').filter(Boolean).join('/');
const key = (m: string, path: string): string => `${m} ${norm(path)}`;
const ALLOW = new Map(KIORLY_ALLOW.map((r) => [key(r.m, r.path), r.level]));

const METHODS: Record<number, KiorlyRoute['m']> = { [RequestMethod.GET]: 'GET', [RequestMethod.POST]: 'POST', [RequestMethod.PUT]: 'PUT', [RequestMethod.PATCH]: 'PATCH', [RequestMethod.DELETE]: 'DELETE' };

/** The route key of a handler (`GET admin/leads/:id`), read from the same decorators Nest routes by. Undefined for anything that is not a plain single-path route (refused for Kiorly roles). */
export function routeKeyOf(controller: object, handler: object): string | undefined {
  const cp = Reflect.getMetadata('path', controller) as unknown; const hp = Reflect.getMetadata('path', handler) as unknown; const m = METHODS[Reflect.getMetadata('method', handler) as number];
  if (!m || typeof cp !== 'string' || typeof hp !== 'string') return undefined;
  return key(m, `${cp}/${hp}`);
}

export type KiorlyDecision = { ok: true } | { ok: false; reason: 'MIXED' | 'REFUSED' };

/** The one decision function (the guard and the tests use it). `roles` must contain a Kiorly role. */
export function kiorlyDecision(roles: readonly string[], routeKey: string | undefined): KiorlyDecision {
  if (hasMixedRoles(roles)) return { ok: false, reason: 'MIXED' };
  const level = routeKey ? ALLOW.get(routeKey) : undefined;
  if (!level) return { ok: false, reason: 'REFUSED' };
  if (level === 'admin' && !roles.includes(KIORLY_ADMIN_ROLE)) return { ok: false, reason: 'REFUSED' };
  return { ok: true };
}

export const kiorlyLevelOf = (routeKey: string): KiorlyLevel | undefined => ALLOW.get(routeKey);
export const kiorlyRouteKey = key;
