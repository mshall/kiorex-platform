import { DEMO_TARGETS, markDemoRows, planDemoRemoval, removalSql, removalWhere, removeDemoRows, type SqlClient } from './demo-data';
import { parseMode } from '../../scripts/demo-data-remove';

function fake() {
  const sql: string[] = [];
  const db: SqlClient = {
    async $executeRawUnsafe(s: string) { sql.push(s); return 0; },
    async $queryRawUnsafe(s: string) { sql.push(s); return [{ n: 0 }] as never; },
  };
  return { db, sql };
}

describe('demo data marker and removal: SQL shape', () => {
  it('removal selects ONLY through the DemoMarker table, never by id pattern, date or tenant', async () => {
    const { db, sql } = fake();
    await removeDemoRows(db); await planDemoRemoval(db);
    const deletes = sql.filter((s) => /^DELETE FROM/.test(s) && !/"DemoMarker"/.test(s.split(' WHERE ')[0]));
    expect(deletes.length).toBeGreaterThan(20);
    for (const s of deletes) {
      expect(s).toContain('"DemoMarker"');
      expect(s).not.toMatch(/LIKE|starts_with|ILIKE|createdAt|tenantId|clinicId|~/);
    }
    for (const s of sql.filter((x) => /^SELECT COUNT/.test(x) && x.includes('FROM "' ) && !x.startsWith('SELECT COUNT(*)::int AS n FROM "DemoMarker"'))) {
      expect(s).toContain('"DemoMarker"');
      expect(s).not.toMatch(/LIKE|starts_with/);
    }
  });

  it('every removal statement is restricted to dataClass DEMO and a single table name', () => {
    for (const t of DEMO_TARGETS) {
      const w = removalWhere(t);
      expect(w).toContain(`"dataClass" = 'DEMO'`);
      expect(w).toMatch(/"tableName" = '[A-Za-z]+'/);
      expect(removalSql(t).del.startsWith(`DELETE FROM "${t.table}" WHERE `)).toBe(true);
    }
  });

  it('children are removed before their parents and every parent exists', () => {
    const order = DEMO_TARGETS.map((t) => t.table);
    for (const t of DEMO_TARGETS) if (t.childOf) {
      expect(order).toContain(t.childOf.parent);
      expect(order.indexOf(t.table)).toBeLessThan(order.indexOf(t.childOf.parent));
    }
  });

  it('tagging uses ON CONFLICT DO NOTHING (idempotent) and binds the batch', async () => {
    const { db, sql } = fake();
    await markDemoRows(db, { batch: 'x' });
    expect(sql.length).toBeGreaterThan(20);
    for (const s of sql) { expect(s).toContain('ON CONFLICT DO NOTHING'); expect(s).toContain('$1'); }
  });

  it('markers are deleted only for known tables, last', async () => {
    const { db, sql } = fake();
    await removeDemoRows(db);
    expect(sql[sql.length - 1]).toMatch(/^DELETE FROM "DemoMarker" WHERE "dataClass" = 'DEMO' AND "tableName" IN \(/);
  });
});

describe('demo-data:remove CLI flags', () => {
  it('dry run is the default', () => expect(parseMode([])).toBe('dry-run'));
  it('--confirm is required to delete', () => { expect(parseMode(['--confirm'])).toBe('confirm'); expect(parseMode(['--dry-run'])).toBe('dry-run'); });
  it('refuses contradictory or unknown flags', () => {
    expect(() => parseMode(['--dry-run', '--confirm'])).toThrow();
    expect(() => parseMode(['--force'])).toThrow();
    expect(() => parseMode(['--mark', '--confirm'])).toThrow();
  });
});
