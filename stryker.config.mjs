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
        "!src/lib/**/*.test.ts",
        "!src/lib/auth-client.ts",
        "!src/lib/auth.ts",
        "!src/lib/schema.ts",
        "!src/lib/db.ts",
        "!src/lib/session.ts",
      ],
  reporters: ["progress", "clear-text", "html"],
  thresholds: {
    high: 100,
    low: 100,
    break: 100,
  },
  timeoutMS: 60000,
  concurrency: 4,
};

export default config;
