import { Injectable } from '@nestjs/common';
import { cfg } from '../common/config';
import { conflict, forbidden, notFound, unavailable } from '../common/errors';
import { FlagsService } from '../control-plane/control-plane-public';
import { PartnerRegistry, PartnerKind } from './partners.service';

export type RoutedKind = Extract<PartnerKind, 'PHARMACY' | 'LAB'>;
export interface RoutedReg { id: string; name: string }
const LOCATION_TTL_MS = 60_000;

/**
 * Which registration owns a pharmacy / lab location. With 0 or 1 live registration of a kind nothing is looked up (the single registration, or the env default, gets
 * everything: unchanged behaviour). With several, the location id is matched against what each registration reports (pharmacies list / test catalogue labs),
 * cached for a minute. An id reported by two partners is ambiguous: the caller must say which partner (`partnerId`). Org-scope flags are evaluated per partner organisation.
 */
@Injectable()
export class PartnerRouting {
  private readonly cache = new Map<string, { at: number; ids: Set<string> }>();
  constructor(private readonly registry: PartnerRegistry, private readonly flags: FlagsService) {}

  /** Is the capability ON for the partner's own organisation? (registrations without a connection record, i.e. dev/env ones, follow the global flag the route guard already checked) */
  async orgAllows(registrationId: string | null | undefined, flagKey: string): Promise<boolean> {
    const orgRef = await this.registry.orgRefOf(registrationId);
    if (!orgRef) return true;
    const e = await this.flags.evaluate(flagKey, { market: cfg().defaultMarket, orgId: orgRef });
    return e.effective;
  }
  async assertOrgAllows(registrationId: string | null | undefined, flagKey: string) {
    if (!(await this.orgAllows(registrationId, flagKey))) throw forbidden('FEATURE_DISABLED', 'This capability is switched off for this partner', { key: flagKey, scope: 'ORG' });
  }

  /** Is any registration of this kind active (even if its org flag is OFF)? No => the env default connection serves the kind. */
  async hasAny(kind: RoutedKind): Promise<boolean> { return (await this.registry.activeRegistrations(kind)).length > 0; }

  /** Live registrations of the kind whose org-scope flag is ON. */
  async live(kind: RoutedKind, flagKey: string): Promise<RoutedReg[]> {
    const regs = await this.registry.activeRegistrations(kind);
    const ok: RoutedReg[] = [];
    for (const r of regs) if (await this.orgAllows(r.id, flagKey)) ok.push({ id: r.id, name: r.name });
    return ok;
  }

  /** Registration for an explicit `partnerId` (must be live and allowed) or, when none, the only live one (null = env default / legacy single). */
  async byPartnerId(kind: RoutedKind, flagKey: string, partnerId: string): Promise<RoutedReg> {
    const reg = (await this.registry.activeRegistrations(kind)).find((r) => r.id === partnerId);
    if (!reg) throw notFound('PARTNER_NOT_FOUND', 'Unknown or inactive partner');
    await this.assertOrgAllows(reg.id, flagKey);
    return { id: reg.id, name: reg.name };
  }

  /**
   * The registration that owns `locationId` (pharmacy branch / lab). `lister` returns the location ids one registration serves.
   * Returns null when there is no live registration (env default connection).
   */
  async resolve(kind: RoutedKind, flagKey: string, locationId: string | undefined, partnerId: string | undefined, lister: (registrationId: string) => Promise<string[]>): Promise<RoutedReg | null> {
    if (partnerId) return this.byPartnerId(kind, flagKey, partnerId);
    const live = await this.live(kind, flagKey);
    if (!live.length) { if ((await this.registry.activeRegistrations(kind)).length) throw forbidden('FEATURE_DISABLED', 'This capability is switched off for this partner', { key: flagKey, scope: 'ORG' }); return null; }
    if (live.length === 1 || !locationId) return live.length === 1 ? live[0]! : null;
    for (const refresh of [false, true]) {
      const owners: RoutedReg[] = []; let failed = 0;
      for (const r of live) {
        try { if ((await this.ids(kind, r.id, lister, refresh)).has(locationId)) owners.push(r); } catch { failed++; }
      }
      if (owners.length === 1) return owners[0]!;
      if (owners.length > 1) throw conflict('AMBIGUOUS_LOCATION', 'More than one partner offers this id: say which partner (partnerId)', { partners: owners.map((o) => ({ partnerId: o.id, name: o.name })) });
      if (refresh) {
        if (failed) throw unavailable('PARTNER_SYSTEM_BUSY', 'A partner system is busy, try again shortly', { retryable: true });
        throw notFound('LOCATION_NOT_FOUND', 'No partner offers this pharmacy or lab');
      }
    }
    return null;
  }

  private async ids(kind: RoutedKind, registrationId: string, lister: (registrationId: string) => Promise<string[]>, refresh: boolean) {
    const key = `${kind}:${registrationId}`; const hit = this.cache.get(key);
    if (hit && !refresh && Date.now() - hit.at < LOCATION_TTL_MS) return hit.ids;
    const ids = new Set(await lister(registrationId));
    this.cache.set(key, { at: Date.now(), ids });
    return ids;
  }
  /** Tests / ops: forget cached locations (e.g. after a registration changed). */
  forget() { this.cache.clear(); }
}
