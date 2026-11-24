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
