import { keyOf, parentKey, splitKey } from './page-model';

/** Roles of a computed link (`SeoInternalLink.anchorKind`). The cap of three per page applies to the cross-link roles (PARENT, NEIGHBOUR, RELATED, CHILD, HUB, ORPHAN_FIX); list roles (DOCTOR, CLINIC) have their own N. */
export const ANCHOR_KINDS = ['PARENT', 'CLINIC', 'DOCTOR', 'HUB', 'NEIGHBOUR', 'RELATED', 'CHILD', 'ORPHAN_FIX'] as const;
export type AnchorKind = (typeof ANCHOR_KINDS)[number];
export const CROSS_LINK_KINDS: readonly AnchorKind[] = ['PARENT', 'NEIGHBOUR', 'RELATED', 'CHILD', 'HUB'];

export type LinkRuleId = 'BREADCRUMB' | 'DOCTOR_CLINIC' | 'CLINIC_DOCTORS' | 'DOCTOR_HUB' | 'HUB_TOP_DOCTORS' | 'NEIGHBOUR_DISTRICTS' | 'RELATED_SPECIALTIES' | 'PARENT_CHILDREN' | 'ORPHAN_FIX';
export interface Candidate { from: string; to: string; rule: LinkRuleId; kind: AnchorKind; /** lower is stronger; ties break on the target key */ rank: number }

/** The page of the graph: one node per locale-neutral key. Names come from the labels at render time. */
export interface GraphNode {
  key: string;
  type: string;
  /** passes the thin-page guard AND the quality gate (a failing or noindex page is never a link target) */
  linkable: boolean;
  /** providers of a listing page, ranked inputs for the top-doctors rule */
  doctors?: { key: string; quality: number; available: boolean }[];
  /** doctor: its clinic page key and its hub keys (district, city, specialty) in order of preference */
  clinicKey?: string | null;
  hubKeys?: string[];
  /** clinic: its doctors */
  clinicDoctors?: { key: string; quality: number; available: boolean }[];
  /** listing: how many providers (ranks neighbours) */
  providerCount?: number;
  specialty?: string; city?: string;
}

const byQuality = (a: { quality: number; available: boolean; key: string }, b: { quality: number; available: boolean; key: string }) =>
  b.quality - a.quality || Number(b.available) - Number(a.available) || (a.key < b.key ? -1 : 1);

export function candidatesFor(n: GraphNode, all: ReadonlyMap<string, GraphNode>, o: { topDoctors: number; clinicDoctors: number; related: Record<string, string[]> }): Candidate[] {
  const out: Candidate[] = []; let r = 0;
  const add = (to: string | null | undefined, rule: LinkRuleId, kind: AnchorKind, rank = r++) => { if (to && to !== n.key) out.push({ from: n.key, to, rule, kind, rank }); };
  const { type } = splitKey(n.key);

  // breadcrumb parents: the content parent (hub of a city page, city of a district page) and the home page
  if (type !== 'home') { add(parentKey(n.key), 'BREADCRUMB', 'PARENT'); add(keyOf('home', ''), 'BREADCRUMB', 'PARENT'); }

  if (type === 'doctor' || type === 'nurse') {
    add(n.clinicKey, 'DOCTOR_CLINIC', 'CLINIC', 0);
    // doctor to the specialty plus district hub (and the specialty hub): the first two linkable hubs in order of preference
    for (const h of (n.hubKeys ?? []).filter((k) => all.get(k)?.linkable).slice(0, 2)) add(h, 'DOCTOR_HUB', 'HUB');
  }
  if (type === 'clinic') for (const d of [...(n.clinicDoctors ?? [])].sort(byQuality).slice(0, o.clinicDoctors)) add(d.key, 'CLINIC_DOCTORS', 'DOCTOR');
  if (['hub', 'city', 'district', 'care-district', 'city-hub', 'district-hub', 'same-day', 'telemedicine'].includes(type)) {
    for (const d of [...(n.doctors ?? [])].sort(byQuality).slice(0, o.topDoctors)) add(d.key, 'HUB_TOP_DOCTORS', 'DOCTOR');
  }
  // neighbouring districts: other districts of the same city (and specialty), most providers first
  if (type === 'district' || type === 'district-hub' || type === 'care-district') {
    const sibs = [...all.values()].filter((x) => x.key !== n.key && x.type === n.type && parentKey(x.key) === parentKey(n.key)).sort((a, b) => (b.providerCount ?? 0) - (a.providerCount ?? 0) || (a.key < b.key ? -1 : 1));
    for (const s of sibs) add(s.key, 'NEIGHBOUR_DISTRICTS', 'NEIGHBOUR');
  }
  // related specialties from the curated map
  if (type === 'hub') {
    const slug = splitKey(n.key).rest;
    for (const rel of o.related[slug] ?? []) add(keyOf('hub', rel), 'RELATED_SPECIALTIES', 'RELATED');
  }
  // children: a hub to its cities, a city to its districts (largest first)
  if (type === 'hub' || type === 'city' || type === 'city-hub') {
    const kids = [...all.values()].filter((x) => parentKey(x.key) === n.key).sort((a, b) => (b.providerCount ?? 0) - (a.providerCount ?? 0) || (a.key < b.key ? -1 : 1));
    for (const k of kids) add(k.key, 'PARENT_CHILDREN', 'CHILD');
  }
  return out;
}
