import { DemoSeedRefusedError, assertDemoSeedAllowed, checkDemoSeedAllowed } from "./demo-seed-guard";

const refuses = (env: Record<string, string>, re: RegExp) => {
  let err: unknown;
  try { checkDemoSeedAllowed(env); } catch (e) { err = e; }
  expect(err).toBeInstanceOf(DemoSeedRefusedError);
  expect((err as Error).message).toMatch(re);
};

describe("demo seed guard (Q10)", () => {
  it("refuses unless DEMO_SEED_ALLOWED=true", () => {
    refuses({ KIORLY_ENV: "staging" }, /DEMO_SEED_ALLOWED/);
    refuses({ KIORLY_ENV: "staging", DEMO_SEED_ALLOWED: "1" }, /DEMO_SEED_ALLOWED/);
  });
  it("hard-fails in production whatever else is set", () => {
    for (const v of ["prod", "production", "PROD", "prd", "live"]) refuses({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: v }, /production/);
    refuses({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "staging", ENV_TAG: "prod" }, /production/); // any variable saying prod wins
    refuses({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "staging", ALLOW_DEMO_SEED: "prod" }, /no override/);
    refuses({ DEMO_SEED_ALLOWED: "true", ALLOW_PRODUCTION_DEMO_SEED: "true", NODE_ENV: "development" }, /no override/);
  });
  it("fails closed when the environment is undeclared under NODE_ENV=production or unknown", () => {
    refuses({ DEMO_SEED_ALLOWED: "true", NODE_ENV: "production" }, /no KIORLY_ENV/);
    refuses({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "eu-customer-a" }, /unknown environment/);
  });
  it("refuses a production-looking database", () => {
    refuses({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "staging", DATABASE_URL: "postgresql://u:p@kiorly-prod.cluster.eu-central-1.rds.amazonaws.com:5432/kiorly" }, /looks like production/);
    refuses({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "staging", DATABASE_URL: "postgresql://u:p@db:5432/kiorly_production" }, /looks like production/);
  });
  it("allows local dev and staging (also with NODE_ENV=production inside the container)", () => {
    expect(checkDemoSeedAllowed({ DEMO_SEED_ALLOWED: "true", NODE_ENV: "development" })).toBe("development");
    expect(checkDemoSeedAllowed({ DEMO_SEED_ALLOWED: "true" })).toBe("local");
    expect(checkDemoSeedAllowed({ DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "staging", NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@kiorly-staging.rds:5432/kiorly" })).toBe("staging");
  });
  it("logs a banner without credentials", () => {
    const lines: string[] = [];
    assertDemoSeedAllowed("unit", { DEMO_SEED_ALLOWED: "true", KIORLY_ENV: "staging", DATABASE_URL: "postgresql://admin:s3cr3t@db.internal:5432/kiorly" }, (m) => lines.push(m));
    expect(lines[0]).toMatch(/DEMO SEED/);
    expect(lines[0]).toMatch(/environment=staging database=kiorly/);
    expect(lines[0]).not.toContain("s3cr3t");
    expect(lines[0]).not.toContain("admin");
  });
});
