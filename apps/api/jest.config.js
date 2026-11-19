const base = {
  preset: "ts-jest",
  testEnvironment: "node",
  transform: { "^.+\\.ts$": ["ts-jest", { isolatedModules: true, diagnostics: false }] },
  moduleFileExtensions: ["ts", "js", "json"],
  rootDir: ".",
};
module.exports = {
  projects: [
    { ...base, displayName: "unit", testMatch: ["<rootDir>/src/**/*.unit.spec.ts"] },
    {
      ...base,
      displayName: "integration",
      testMatch: ["<rootDir>/test/**/*.int.spec.ts"],
      setupFiles: ["<rootDir>/test/env-setup.ts"],
      globalSetup: "<rootDir>/test/global-setup.ts",
      testTimeout: 30000,
    },
  ],
};
