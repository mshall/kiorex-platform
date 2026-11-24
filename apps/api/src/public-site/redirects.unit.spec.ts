import { resolveSlug, type SlugStore } from './redirects.service';

/** In-memory store: current slug rows and history rows keyed like the B0 tables. */
function store(current: Record<string, string>, history: Record<string, string | null>): SlugStore {
  const byEntity = new Map(Object.entries(current).map(([slug, id]) => [id, slug]));
  return {
    current: async (m, t, s) => (current[s] ? { entityId: current[s]!, slug: s } : null),
    history: async (m, t, s) => (s in history ? { entityId: [...byEntity.keys()][0]!, replacedBy: history[s] ?? null } : null),
    currentFor: async (m, t, id) => byEntity.get(id) ?? null,
    currentForMany: async (m, t, ids) => new Map(ids.filter((i) => byEntity.has(i)).map((i) => [i, byEntity.get(i)!])),
  };
}

describe('slug history resolution (GrowthSlug and GrowthSlugHistory)', () => {
  const s = store({ 'sara-hassan': 'lst_a' }, { 'dr-sara': 'sara-hassan' });
  it('the current slug resolves to its entity', async () => { expect(await resolveSlug(s, 'EG', 'DOCTOR', 'sara-hassan')).toEqual({ kind: 'found', entityId: 'lst_a', slug: 'sara-hassan' }); });
  it('an old slug moves to the entity current slug, even after several renames', async () => {
    expect(await resolveSlug(s, 'EG', 'DOCTOR', 'dr-sara')).toEqual({ kind: 'moved', entityId: 'lst_a', slug: 'sara-hassan' });
    const renamed = store({ 'sara-h': 'lst_a' }, { 'dr-sara': 'sara-hassan', 'sara-hassan': 'sara-h' });
    expect(await resolveSlug(renamed, 'EG', 'DOCTOR', 'dr-sara')).toEqual({ kind: 'moved', entityId: 'lst_a', slug: 'sara-h' });
  });
  it('an unknown slug, or a history row whose entity lost its slug, is unknown (404)', async () => {
    expect(await resolveSlug(s, 'EG', 'DOCTOR', 'nobody')).toEqual({ kind: 'unknown' });
    expect(await resolveSlug(store({}, { 'dr-sara': null }), 'EG', 'DOCTOR', 'dr-sara')).toEqual({ kind: 'unknown' });
  });
});
