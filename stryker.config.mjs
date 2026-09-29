import { STRYKER_MUTATE } from "./scripts/ci-changed.mjs";

const scopedMutate = process.env.STRYKER_MUTATE?.split(",").map((s) => s.trim()).filter(Boolean);
const scopedTestCommand = process.env.STRYKER_TEST_COMMAND;

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "command",
  commandRunner: {
    // Partial CI narrows this to the tests that import the mutated files.
    command: scopedTestCommand || "npm test",
  },
  coverageAnalysis: "off",
  checkers: ["typescript"],
  tsconfigFile: "tsconfig.json",
  // Default list lives in scripts/ci-changed.mjs; partial CI sets STRYKER_MUTATE.
  mutate: scopedMutate?.length ? scopedMutate : STRYKER_MUTATE,
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
