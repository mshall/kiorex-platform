// Memory: the integration project needs --experimental-vm-modules (Nest 12 is ESM), and Node retains every test file's vm context
// (module graph of AppModule + generated Prisma client, ~35-90 MB per file) for the life of the process even after app.close().
// ~110 files in one --runInBand process therefore exceed the default ~4.5 GB heap; `npm run test:integration` sets
// --max-old-space-size=12288 as headroom. Running the whole suite with a lower limit ends in a V8 out-of-memory crash, not a test failure.
const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { diagnostics: false }] },
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: ".",
};
module.exports = {
  testTimeout: 30000,
  maxWorkers: 1,
  projects: [
    { ...base, displayName: "unit", testMatch: ["<rootDir>/src/**/*.unit.spec.ts"] },
    {
      ...base,
      displayName: "integration",
      testMatch: ["<rootDir>/test/**/*.int.spec.ts"],
      setupFiles: ["<rootDir>/test/env-setup.ts"],
      globalSetup: "<rootDir>/test/global-setup.ts",
      globalTeardown: "<rootDir>/test/global-teardown.ts",
    },
  ],
};
