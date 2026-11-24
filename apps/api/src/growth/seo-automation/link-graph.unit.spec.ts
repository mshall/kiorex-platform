import { buildLinkGraph, enforceAnchorVariety, findOrphans, fixOrphans, type GraphOptions } from './link-graph';
import { CROSS_LINK_KINDS, type GraphNode } from './link-rules';

const O: GraphOptions = { maxPerPage: 50, maxPerAnchorKind: 3, topDoctors: 6, clinicDoctors: 12, related: { cardiology: ['internal-medicine', 'vascular-surgery', 'dermatology', 'x-y-z'] } };
const docs = (n: number, prefix = 'd') => Array.from({ length: n }, (_, i) => ({ key: `doctor:${prefix}${String(i).padStart(2, '0')}`, quality: 5 - i * 0.1, available: i % 2 === 0 }));
const node = (key: string, o: Partial<GraphNode> = {}): GraphNode => ({ key, type: key.split(':')[0]!, linkable: true, ...o });

/** A small market: home, two specialty hubs, a city, four districts, one clinic, twenty doctors. */
const market = (): GraphNode[] => {
  const dd = docs(20);
  return [
    node('home:'), node('hub:cardiology', { doctors: dd, providerCount: 20 }), node('hub:internal-medicine', { doctors: dd.slice(0, 3), providerCount: 3 }), node('hub:vascular-surgery'), node('hub:dermatology'),
    node('city:cardiology/cairo', { doctors: dd, providerCount: 12 }),
    node('district:cardiology/cairo/maadi', { doctors: dd.slice(0, 8), providerCount: 8 }), node('district:cardiology/cairo/dokki', { providerCount: 5 }), node('district:cardiology/cairo/nasr', { providerCount: 4 }), node('district:cardiology/cairo/zayed', { providerCount: 3 }), node('district:cardiology/cairo/haram', { providerCount: 2 }),
    node('clinic:heart-care', { clinicDoctors: dd.slice(0, 14) }),
    ...dd.map((d) => node(d.key, { clinicKey: 'clinic:heart-care', hubKeys: ['district:cardiology/cairo/maadi', 'city:cardiology/cairo', 'hub:cardiology'] })),
  ];
};
const edgesFrom = (r: ReturnType<typeof buildLinkGraph>, k: string) => r.edges.filter((e) => e.fromKey === k);

describe('internal link graph', () => {
  it('is deterministic: same nodes in any order produce identical edges in identical order', () => {
    const a = buildLinkGraph(market(), O).edges; const b = buildLinkGraph([...market()].reverse(), O).edges;
    expect(b).toEqual(a);
    expect(buildLinkGraph(market(), O).edges).toEqual(a);
  });
  it('caps: at most 50 links per page and at most three of each cross-link role', () => {
    const many = [...market(), ...Array.from({ length: 80 }, (_, i) => node(`doctor:x${i}`, { clinicKey: 'clinic:big' })), node('clinic:big', { clinicDoctors: Array.from({ length: 80 }, (_, i) => ({ key: `doctor:x${i}`, quality: 1, available: false })) })];
    const r = buildLinkGraph(many, { ...O, clinicDoctors: 80 });
    const per = new Map<string, number>(); for (const e of r.edges) per.set(e.fromKey, (per.get(e.fromKey) ?? 0) + 1);
    for (const [k, n] of per) expect({ k, ok: n <= 50 }).toEqual({ k, ok: true });
    expect(per.get('clinic:big')).toBe(50); expect(r.dropped.capPage).toBeGreaterThan(0);
    for (const n of many) for (const kind of CROSS_LINK_KINDS) expect(edgesFrom(r, n.key).filter((e) => e.anchorKind === kind).length).toBeLessThanOrEqual(3);
    // neighbouring districts: 4 candidates, three links
    expect(edgesFrom(r, 'district:cardiology/cairo/maadi').filter((e) => e.rule === 'NEIGHBOUR_DISTRICTS').map((e) => e.toKey)).toEqual(['district:cardiology/cairo/dokki', 'district:cardiology/cairo/nasr', 'district:cardiology/cairo/zayed']);
  });
  it('rules: doctor to clinic and to the district and specialty hubs; clinic to its best doctors; hub to its top doctors by quality then availability', () => {
    const r = buildLinkGraph(market(), O);
    expect(edgesFrom(r, 'doctor:d00').map((e) => `${e.rule}>${e.toKey}`)).toEqual(expect.arrayContaining(['DOCTOR_CLINIC>clinic:heart-care', 'DOCTOR_HUB>district:cardiology/cairo/maadi', 'DOCTOR_HUB>city:cardiology/cairo']));
    expect(edgesFrom(r, 'clinic:heart-care').filter((e) => e.rule === 'CLINIC_DOCTORS')).toHaveLength(12);
    expect(edgesFrom(r, 'hub:cardiology').filter((e) => e.rule === 'HUB_TOP_DOCTORS').map((e) => e.toKey)).toEqual(['doctor:d00', 'doctor:d01', 'doctor:d02', 'doctor:d03', 'doctor:d04', 'doctor:d05']);
    expect(edgesFrom(r, 'hub:cardiology').filter((e) => e.rule === 'RELATED_SPECIALTIES').map((e) => e.toKey)).toEqual(['hub:internal-medicine', 'hub:vascular-surgery', 'hub:dermatology']); // curated four, capped at three
    expect(edgesFrom(r, 'district:cardiology/cairo/maadi').map((e) => e.rule)).toEqual(expect.arrayContaining(['BREADCRUMB', 'HUB_TOP_DOCTORS', 'NEIGHBOUR_DISTRICTS']));
    expect(edgesFrom(r, 'city:cardiology/cairo').filter((e) => e.rule === 'PARENT_CHILDREN')).toHaveLength(3);
  });
  it('quality beats availability beats key (ties are stable)', () => {
    const nodes = [node('hub:cardiology', { doctors: [{ key: 'doctor:b', quality: 4, available: false }, { key: 'doctor:a', quality: 4, available: false }, { key: 'doctor:c', quality: 4, available: true }, { key: 'doctor:z', quality: 4.5, available: false }] }), ...['a', 'b', 'c', 'z'].map((k) => node(`doctor:${k}`))];
    expect(edgesFrom(buildLinkGraph(nodes, { ...O, topDoctors: 4 }), 'hub:cardiology').filter((e) => e.rule === 'HUB_TOP_DOCTORS').map((e) => e.toKey)).toEqual(['doctor:z', 'doctor:c', 'doctor:a', 'doctor:b']);
  });
  it('never links to a noindex or failing page, never to itself, and a page that is not linkable has no computed links', () => {
    const nodes = market().map((n) => (n.key === 'clinic:heart-care' || n.key === 'district:cardiology/cairo/maadi' ? { ...n, linkable: false } : n));
    const r = buildLinkGraph(nodes, O);
    expect(r.edges.some((e) => e.toKey === 'clinic:heart-care' || e.toKey === 'district:cardiology/cairo/maadi')).toBe(false);
    expect(r.edges.some((e) => e.fromKey === 'clinic:heart-care' || e.fromKey === 'district:cardiology/cairo/maadi')).toBe(false);
    expect(r.edges.some((e) => e.fromKey === e.toKey)).toBe(false);
    expect(r.dropped.notLinkable).toBeGreaterThan(0);
    // the doctor falls back to the next linkable hub
    expect(edgesFrom(r, 'doctor:d00').filter((e) => e.rule === 'DOCTOR_HUB').map((e) => e.toKey)).toEqual(['city:cardiology/cairo', 'hub:cardiology']);
  });
  it('orphans: detected from inbound counts and repaired from the parent (or home) without breaking the page cap', () => {
    const nodes = market(); const g = buildLinkGraph(nodes, O);
    const inbound = new Map<string, number>(); for (const e of g.edges) inbound.set(e.toKey, (inbound.get(e.toKey) ?? 0) + 1);
    const orphans = findOrphans(nodes, inbound);
    expect(orphans).toContain('district:cardiology/cairo/haram'); // the fifth district: not in the three neighbours or children of anyone
    expect(orphans).not.toContain('home:');
    const fix = fixOrphans(orphans, nodes, g.edges, O);
    expect(fix.every((e) => e.rule === 'ORPHAN_FIX' && e.anchorKind === 'ORPHAN_FIX')).toBe(true);
    const after = [...g.edges, ...fix]; const inb2 = new Map<string, number>(); for (const e of after) inb2.set(e.toKey, (inb2.get(e.toKey) ?? 0) + 1);
    expect(findOrphans(nodes, inb2)).toEqual([]);
    expect(fixOrphans(orphans, nodes, after, O)).toEqual(fix.length ? expect.any(Array) : []);
    const full = fixOrphans(['district:cardiology/cairo/haram'], nodes, Array.from({ length: 50 }, (_, i) => ({ fromKey: 'city:cardiology/cairo', toKey: `x${i}`, rule: 'PARENT_CHILDREN' as const, anchorKind: 'CHILD' as const, rank: i })), O);
    expect(full.every((e) => e.fromKey !== 'city:cardiology/cairo')).toBe(true); // the parent is full: the home page takes it
  });
  it('anchor variety: a page of more than ten links with few distinct anchors loses the repeats; a varied one is untouched', () => {
    const mk = (n: number): { fromKey: string; toKey: string; rule: 'HUB_TOP_DOCTORS'; anchorKind: 'DOCTOR'; rank: number }[] => Array.from({ length: n }, (_, i) => ({ fromKey: 'p', toKey: `t${i}`, rule: 'HUB_TOP_DOCTORS', anchorKind: 'DOCTOR', rank: i }));
    const same = enforceAnchorVariety(mk(12), (t) => (Number(t.slice(1)) < 3 ? t : 'Dr Sara Hassan'), 0.6);
    expect(same.dropped.length).toBeGreaterThan(0); expect(new Set(same.kept.map((e) => (Number(e.toKey.slice(1)) < 3 ? e.toKey : 'Dr Sara Hassan'))).size).toBe(same.kept.length);
    expect(enforceAnchorVariety(mk(12), (t) => t, 0.6).dropped).toEqual([]);
    expect(enforceAnchorVariety(mk(8), () => 'x', 0.6).dropped).toEqual([]); // 10 or fewer links: no rule
  });
});
