/**
 * Durable DEMO data marker and removal (side table "DemoMarker", dataClass DEMO).
 *
 * WHY a marker and not an id pattern: the founder will later ask "remove the dummy records". Deleting by id pattern (`demo_%`) would stay correct only while
 * nobody ever creates a real row with such an id. The marker is written ONCE, at seed time, for exactly the rows the demo seed created; removal then selects
 * ONLY rows named in "DemoMarker" (plus their dependent children), never by pattern, never by date, never by tenant. A real row has no marker, so it cannot be selected.
 *
 *   markDemoRows(prisma)        idempotent: registers the rows the demo seed creates (matched by the seed's own id conventions, evaluated at this moment only)
 *   planDemoRemoval(prisma)     dry run: counts per table, writes nothing
 *   removeDemoRows(prisma)      deletes the marked rows (children first) in one transaction and then their markers; idempotent
 *
 * All SQL is built from the constant TARGETS table below (identifiers are never taken from input; values are bound parameters).
 */
export interface SqlClient {
  $executeRawUnsafe(sql: string, ...values: unknown[]): Promise<number>;
  $queryRawUnsafe<T = unknown>(sql: string, ...values: unknown[]): Promise<T>;
}

export interface DemoTarget {
  /** Postgres table (Prisma model name). */
  table: string;
  /** SQL expression for the marker key of a row (default "id"). Composite keys use "a" || ':' || "b". */
  key?: string;
  /** TAG TIME ONLY: predicate (over the table, unaliased) naming the rows the demo seed creates. `$S` is replaced by the extra-sub list placeholder. Absent = never tagged by pattern. */
  seededWhere?: string;
  /** REMOVAL: a child table without markers of its own, deleted by foreign key to marked rows of `parent`. */
  childOf?: { parent: string; fk: string; parentKey?: string };
}

const DEMO_SUBS = `starts_with("sub", '01HZKXD')`;
/**
 * Deletion order = list order (children before parents; same order as the long-standing `seed-demo --reset`). Every table the demo seeds write to is here.
 */
export const DEMO_TARGETS: DemoTarget[] = [
  { table: 'LedgerEntry', childOf: { parent: 'LedgerTx', fk: 'txId' } },
  { table: 'LedgerTx', seededWhere: `starts_with("idempotencyKey", 'demo:')` },
  { table: 'Refund', seededWhere: `starts_with("id", 'demo_rf_')` },
  { table: 'Payout', seededWhere: `starts_with("id", 'demo_po_')` },
  { table: 'PaymentIntent', seededWhere: `starts_with("id", 'demo_pay_') OR starts_with("id", 'demo_vpay_')` },
  { table: 'Review', childOf: { parent: 'BookingIntent', fk: 'bookingId' } },
  { table: 'TeleSession', childOf: { parent: 'BookingIntent', fk: 'bookingId' } },
  { table: 'BookingEvent', childOf: { parent: 'BookingIntent', fk: 'bookingId' } },
  { table: 'Message', seededWhere: `starts_with("id", 'demo_msg_')` },
  { table: 'MessageLog', seededWhere: `starts_with("id", 'demo_ml_')` },
  { table: 'WaitlistOffer', seededWhere: `starts_with("id", 'demo_wo_')` },
  { table: 'WaitlistEntry', seededWhere: `starts_with("id", 'demo_wl_')` },
  { table: 'SharedRecord', seededWhere: `starts_with("id", 'demo_rec_')` },
  { table: 'RecordShareConsent', key: `"sub" || ':' || "scope"`, seededWhere: DEMO_SUBS },
  { table: 'FollowUpReminder', seededWhere: `starts_with("id", 'demo_fu_')` },
  { table: 'PharmacyOrder', seededWhere: `starts_with("id", 'kx_ph_demo_')` },
  { table: 'LabBooking', seededWhere: `starts_with("id", 'kx_lb_demo_')` },
  { table: 'NurseLabRelay', seededWhere: `starts_with("id", 'demo_lo_')` },
  { table: 'SafetyAlertAction', childOf: { parent: 'SafetyAlert', fk: 'alertId' } },
  { table: 'SafetyAlert', seededWhere: `starts_with("id", 'kx_sa_demo_')` },
  { table: 'FamilyShare', seededWhere: `starts_with("id", 'kx_fs_demo_')` },
  { table: 'CarePlanBooking', seededWhere: `starts_with("id", 'kx_cp_demo_')` },
  { table: 'BookingVisitAddress', childOf: { parent: 'BookingIntent', fk: 'bookingId' } },
  { table: 'BookingIntent', seededWhere: `starts_with("id", 'demo_bk_')` },
  { table: 'PatientAddress', seededWhere: `starts_with("id", 'kx_ad_demo_')` },
  { table: 'KiorlyPatientLink', seededWhere: `${DEMO_SUBS} OR starts_with("id", 'demo_kl_')` },
  { table: 'Dependant', seededWhere: `starts_with("id", 'demo_dep_')` },
  // ConsentRecord is deliberately NOT a target: it is an append-only consent audit (trigger consent_record_immutable blocks DELETE, ADR consent history). The demo
  // consent rows (ids demo_cr_*, demo subs) stay as inert audit rows; this tool never disables a trigger or weakens an audit control.
  { table: 'PatientProfile', seededWhere: DEMO_SUBS },
  // the dev-only gate evidence the dev seeds record is labelled DEV-ONLY-NOT-A-REAL-GATE; it is dummy by definition and must not outlive the demo data
  { table: 'FlagGateEvidence', key: `"flagKey" || ':' || "gateId"`, seededWhere: `starts_with("gateId", 'DEV-ONLY-NOT-A-REAL-GATE')` },
];

const q = (ident: string): string => { if (!/^[A-Za-z][A-Za-z0-9_]*$/.test(ident)) throw new Error(`bad identifier ${ident}`); return `"${ident}"`; };
const keyOf = (t: DemoTarget): string => t.key ?? '"id"';
const CLASS = 'DEMO';

/** Marker rows of one table (the ONLY selector removal uses). */
const markedKeys = (table: string): string => `SELECT "rowId" FROM "DemoMarker" WHERE "dataClass" = '${CLASS}' AND "tableName" = '${table.replace(/'/g, '')}'`;

/** SQL that selects the rows of `t` to remove (used for the dry-run count and for the delete). Exposed for tests. */
export function removalWhere(t: DemoTarget): string {
  if (t.childOf) {
    const parent = DEMO_TARGETS.find((x) => x.table === t.childOf!.parent);
    if (!parent) throw new Error(`unknown parent ${t.childOf.parent}`);
    const pk = t.childOf.parentKey ?? '"id"';
    return `${q(t.childOf.fk)} IN (SELECT ${pk} FROM ${q(parent.table)} WHERE ${keyOf(parent)} IN (${markedKeys(parent.table)}))`;
  }
  return `${keyOf(t)} IN (${markedKeys(t.table)})`;
}
export const removalSql = (t: DemoTarget): { count: string; del: string } => ({
  count: `SELECT COUNT(*)::int AS n FROM ${q(t.table)} WHERE ${removalWhere(t)}`,
  del: `DELETE FROM ${q(t.table)} WHERE ${removalWhere(t)}`,
});

/** Registers the rows the demo seed created. Idempotent (ON CONFLICT DO NOTHING). `extraSubs` = Cognito subs of the demo personas on AWS (DEMO_SUB_MAP_JSON). */
export async function markDemoRows(db: SqlClient, opts: { batch?: string; extraSubs?: string[]; only?: string[] } = {}): Promise<Record<string, number>> {
  const batch = opts.batch ?? 'seed-demo';
  const extra = (opts.extraSubs ?? []).filter((s) => /^[A-Za-z0-9_.:-]{3,128}$/.test(s));
  const out: Record<string, number> = {};
  for (const t of DEMO_TARGETS) {
    if (!t.seededWhere || (opts.only && !opts.only.includes(t.table))) continue;
    let where = t.seededWhere;
    const params: unknown[] = [batch];
    if (extra.length && where.includes(DEMO_SUBS)) { params.push(extra); where = `(${where} OR "sub" = ANY($2::text[]))`; }
    const n = await db.$executeRawUnsafe(
      `INSERT INTO "DemoMarker" ("tableName", "rowId", "dataClass", "batch") SELECT '${t.table}', ${keyOf(t)}, '${CLASS}', $1 FROM ${q(t.table)} WHERE ${where} ON CONFLICT DO NOTHING`,
      ...params,
    ).catch((e: unknown) => { if (/does not exist/i.test(String((e as Error).message))) return 0; throw e; });
    if (n) out[t.table] = n;
  }
  return out;
}

export interface DemoPlan { table: string; rows: number; markers: number }
/** Dry run: how many rows removal WOULD delete per table. Writes nothing. */
export async function planDemoRemoval(db: SqlClient): Promise<{ total: number; tables: DemoPlan[]; orphanMarkers: number }> {
  const tables: DemoPlan[] = [];
  for (const t of DEMO_TARGETS) {
    const s = removalSql(t);
    const rows = await db.$queryRawUnsafe<{ n: number }[]>(s.count).catch((e: unknown) => { if (/does not exist/i.test(String((e as Error).message))) return [{ n: 0 }]; throw e; });
    const markers = t.childOf ? 0 : (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "DemoMarker" WHERE "dataClass" = '${CLASS}' AND "tableName" = '${t.table}'`))[0]?.n ?? 0;
    if ((rows[0]?.n ?? 0) > 0 || markers > 0) tables.push({ table: t.table, rows: rows[0]?.n ?? 0, markers });
  }
  const known = DEMO_TARGETS.filter((t) => !t.childOf).map((t) => `'${t.table}'`).join(',');
  const orphan = (await db.$queryRawUnsafe<{ n: number }[]>(`SELECT COUNT(*)::int AS n FROM "DemoMarker" WHERE "dataClass" = '${CLASS}' AND "tableName" NOT IN (${known})`))[0]?.n ?? 0;
  return { total: tables.reduce((a, x) => a + x.rows, 0), tables, orphanMarkers: orphan };
}

/** Deletes the marked rows, children first, then the markers. Run it inside a transaction (the CLI does). Returns rows deleted per table. */
export async function removeDemoRows(db: SqlClient): Promise<Record<string, number>> {
  const out: Record<string, number> = {};
  for (const t of DEMO_TARGETS) {
    const n = await db.$executeRawUnsafe(removalSql(t).del).catch((e: unknown) => { if (/does not exist/i.test(String((e as Error).message))) return 0; throw e; });
    if (n) out[t.table] = n;
  }
  // markers go last (children above were found through their parents' markers); a marker of a table this version does not know is left alone
  const known = DEMO_TARGETS.filter((t) => !t.childOf).map((t) => `'${t.table}'`).join(',');
  await db.$executeRawUnsafe(`DELETE FROM "DemoMarker" WHERE "dataClass" = '${CLASS}' AND "tableName" IN (${known})`);
  return out;
}
