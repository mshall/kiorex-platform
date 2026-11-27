/**
 * Prints the public join-form configuration the API serves on a fresh database (GET /api/v1/public/leads/config), as JSON.
 * The Kiorly site embeds this as its offline default (kiorex-account/apps/kiorly-site/src/form-defaults.json) and replaces it at runtime with the live answer.
 *   npx ts-node --transpile-only scripts/emit-lead-form-defaults.ts > ../../../kiorex-account/apps/kiorly-site/src/form-defaults.json
 */
import { DEFAULT_LEAD_CONFIG, TYPE_FIELDS } from '../src/leads/lead-config';

const on = <T extends { active: boolean }>(l: T[]) => l.filter((x) => x.active);
const c = DEFAULT_LEAD_CONFIG;
const typeFields = Object.fromEntries(on(c.providerTypes).map((t) => { const s = TYPE_FIELDS[t.key] ?? TYPE_FIELDS.OTHER!; return [t.key, { fields: s.fields, answers: s.answers, minBranches: s.minBranches ?? null }]; }));
const out = {
  providerTypes: on(c.providerTypes), specialties: on(c.specialties), modules: on(c.modules), goLive: on(c.goLive), software: on(c.software), contactChannels: on(c.contactChannels), contactTimes: on(c.contactTimes),
  markets: on(c.markets).map((m) => ({ ...m, governorates: on(m.governorates) })), requiredFields: c.requiredFields, typeFields, modes: ['STANDALONE', 'CONNECTED'], limits: { note: 1000, legalName: 120, services: 300, licence: 40 },
};
process.stdout.write(`${JSON.stringify(out, null, 2)}\n`);
