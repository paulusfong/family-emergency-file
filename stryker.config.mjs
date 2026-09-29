import { STRYKER_MUTATE } from "./scripts/ci-changed.mjs";

const scopedMutate = process.env.STRYKER_MUTATE?.split(",").map((s) => s.trim()).filter(Boolean);
const scopedTestCommand = process.env.STRYKER_TEST_COMMAND;

// Cap each mutant's test processes (node --test children inherit NODE_OPTIONS).
// A mutant that turns autosave's retry into an endless loop otherwise grows to
// 3+ GB per worker and takes the CI runner down; capped, it dies in seconds
// with a non-zero exit, which Stryker counts as killed.
const HEAP_CAP = "NODE_OPTIONS=--max-old-space-size=512";

/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
const config = {
  packageManager: "npm",
  testRunner: "command",
  commandRunner: {
    // Partial CI narrows this to the tests that import the mutated files.
    command: `${HEAP_CAP} ${scopedTestCommand || "npm test"}`,
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
