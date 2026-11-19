import fs from "node:fs";
import path from "node:path";
import en from "@/i18n/locales/en.json";
import ar from "@/i18n/locales/ar.json";

type Tree = { [k: string]: string | Tree };
const flat = (o: Tree, p = ""): string[] => Object.entries(o).flatMap(([k, v]) => (typeof v === "string" ? [p + k] : flat(v, `${p}${k}.`)));
// i18next plural suffixes collapse to the base key for existence checks.
const base = (k: string) => k.replace(/_(zero|one|two|few|many|other)$/, "");
const enKeys = new Set(flat(en as Tree).map(base));
const arKeys = new Set(flat(ar as Tree).map(base));

const walk = (d: string): string[] => fs.readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? (e.name === "node_modules" || e.name === "__tests__" ? [] : walk(path.join(d, e.name))) : /\.tsx?$/.test(e.name) ? [path.join(d, e.name)] : []));
const root = path.resolve(__dirname, "../..");
const used = new Set<string>();
for (const f of [...walk(path.join(root, "app")), ...walk(path.join(root, "src"))]) for (const m of fs.readFileSync(f, "utf8").matchAll(/\bt\(\s*"([A-Za-z0-9_.]+)"/g)) used.add(m[1]);

describe("i18n (AR + EN parity)", () => {
  it("every statically used key exists in both languages", () => {
    expect([...used].filter((k) => !enKeys.has(k))).toEqual([]);
    expect([...used].filter((k) => !arKeys.has(k))).toEqual([]);
  });
  it("Arabic and English define the same keys", () => {
    expect([...enKeys].filter((k) => !arKeys.has(k))).toEqual([]);
    expect([...arKeys].filter((k) => !enKeys.has(k))).toEqual([]);
  });
  it("dynamic enum keys are all translated", () => {
    const need = [
      ...["VISIT_SUMMARY", "PRESCRIPTION", "LAB_RESULT", "UPLOAD"].flatMap((k) => [`records.kind.${k}`, `records.filter.${k}`]), "records.filter.ALL",
      ...["CLINIC", "LAB", "PATIENT"].map((k) => `records.source.${k}`),
      ...["VISIT_SUMMARY", "PRESCRIPTIONS", "LAB_RESULTS", "SHARE_WITH_OTHER_CLINICS"].map((k) => `sharing.scope.${k}.title`),
      ...["WAITING", "OFFERED", "BOOKED", "CANCELLED", "EXPIRED"].map((k) => `waitlist.status.${k}`),
      ...["PENDING_PAYMENT", "PAID", "SUBMITTED", "READY", "DISPENSED", "PARTIAL_REVIEW", "REJECTED", "CANCELLED"].map((k) => `pharmacy.status.${k}`),
      ...["NOT_REQUIRED", "PENDING", "VALID", "INVALID"].map((k) => `pharmacy.rx.${k}`),
      ...["PENDING_PAYMENT", "PAID", "SUBMITTED", "RESULT_RELEASED", "REJECTED", "CANCELLED"].map((k) => `lab.status.${k}`),
      ...["SCHEDULED", "WAITING", "IN_PROGRESS", "ENDED", "CANCELLED"].map((k) => `tele.status.${k}`),
      ...["SCHEDULED", "DUE", "CANCELLED"].map((k) => `followUps.status.${k}`), "followUps.source.DOCTOR", "followUps.source.PATIENT",
      "channel.marketplace", "channel.clinicLink", "channel.whatsapp", "records.pick.type", "records.pick.size", "records.pick.failed",
    ];
    expect(need.filter((k) => !enKeys.has(k) || !arKeys.has(k))).toEqual([]);
  });
});
