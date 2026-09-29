const scopedMutate = process.env.STRYKER_MUTATE?.split(",").map((s) => s.trim()).filter(Boolean);
const scopedTestCommand = process.env.STRYKER_TEST_COMMAND;

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "command",
  commandRunner: {
    command: scopedTestCommand || "npm test",
  },
  coverageAnalysis: "off",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  mutate: scopedMutate?.length
    ? scopedMutate
    : [
        "src/lib/**/*.ts",
        "src/app/actions.ts",
        "src/proxy.ts",
        "!src/**/*.test.ts",
        // Client-only better-auth wrapper; no logic.
        "!src/lib/auth-client.ts",
        // better-auth config object; behaviour covered via auth.coverage.test.ts.
        "!src/lib/auth.ts",
        // Drizzle table declarations; FK/index shape asserted in schema.test.ts.
        "!src/lib/schema.ts",
        // libsql client bootstrap; resolveDbCredentials is covered by db.coverage.test.ts.
        "!src/lib/db.ts",
      ],
  reporters: ["progress", "clear-text", "html"],
  thresholds: {
    high: 100,
    low: 95,
    break: 90,
  },
  timeoutMS: 60000,
  concurrency: 4,
};

export default config;
