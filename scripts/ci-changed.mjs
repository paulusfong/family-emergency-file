#!/usr/bin/env node
/**
 * Decide which unit tests and Stryker mutate targets a PR (or push) needs.
 *
 * Usage: node scripts/ci-changed.mjs plan|tests|mutate|mutate-tests|shards
 *   plan         -> JSON { mode, testFiles, mutateFiles, mutateTestFiles, reason, changed }
 *   tests        -> newline-separated unit test files ("FULL" or "" for full/skip)
 *   mutate       -> comma-separated Stryker mutate paths ("FULL" or "")
 *   mutate-tests -> newline-separated tests that exercise those mutants
 *   shards       -> JSON matrix [{ name, mutate, tests }] for parallel Stryker jobs:
 *                   every target in full mode, changed targets in partial mode
 *
 * Modes: "full" when deps or test/mutation tooling changed, "partial" for
 * source/test changes (tests that import a changed file, transitively), "skip"
 * when nothing under src/ changed. The whole-src coverage gate runs in every
 * mode; it is not planned here.
 */
import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

/** Mutated outside src/lib. Keep business logic here, not in pages. */
export const MUTATE_EXTRA = [
  "src/app/actions.ts",
  "src/app/app/actions.ts",
  "src/app/app/export/json/route.ts",
  "src/app/app/export/pdf/route.ts",
  "src/app/app/sections/actions.ts",
  "src/app/app/settings/delete/actions.ts",
  "src/proxy.ts",
];

/** src/lib modules Stryker skips (config objects and bootstraps; covered by tests). */
export const STRYKER_EXCLUDED = [
  "src/lib/auth-client.ts",
  "src/lib/auth.ts",
  "src/lib/schema.ts",
  "src/lib/db.ts",
  // Copy only (checklist labels, why-it-matters lines), pinned by content tests; not worth mutating.
  "src/lib/section-content.ts",
];

/** Stryker `mutate` globs; stryker.config.mjs imports this so the two never drift. */
export const STRYKER_MUTATE = [
  "src/lib/**/*.ts",
  ...MUTATE_EXTRA,
  "!src/**/*.test.ts",
  ...STRYKER_EXCLUDED.map((f) => `!${f}`),
];

export const FULL_TRIGGERS = [
  "package.json",
  "package-lock.json",
  "tsconfig.json",
  "stryker.config.mjs",
  ".c8rc.json",
];

/** Harness paths: shared test setup and migrations change every DB-backed test. */
export const FULL_PREFIXES = ["scripts/", "src/test/", "drizzle/"];

export const TEST_COMMAND =
  "node --experimental-test-module-mocks --import tsx --import ./src/test/setup.mjs --test";

export function isTest(f) {
  return (f.startsWith("src/") || f.startsWith("scripts/")) && f.includes(".test.");
}

export function isSource(f) {
  return f.startsWith("src/") && /\.(tsx?|mjs|js)$/.test(f) && !isTest(f) && !f.startsWith("src/test/");
}

export function isMutateTarget(f) {
  if (isTest(f) || STRYKER_EXCLUDED.includes(f)) return false;
  return MUTATE_EXTRA.includes(f) || (f.startsWith("src/lib/") && f.endsWith(".ts"));
}

export function forceFull(files) {
  return files.some((f) => FULL_TRIGGERS.includes(f) || FULL_PREFIXES.some((p) => f.startsWith(p)));
}

const SPECIFIER = /(?:from\s+|import\s*\(\s*|mock\.module\(\s*)["']([^"']+)["']/g;
const EXTENSIONS = ["", ".ts", ".tsx", ".mjs", ".js", "/index.ts", "/index.tsx"];

/** Resolve an import specifier to a repo-relative file, or null for packages. */
export function resolveImport(fromFile, spec, exists) {
  let base;
  if (spec.startsWith("@/")) base = path.posix.join("src", spec.slice(2));
  else if (spec.startsWith(".")) base = path.posix.join(path.posix.dirname(fromFile), spec);
  else return null;
  for (const ext of EXTENSIONS) {
    if (exists(base + ext)) return base + ext;
  }
  return null;
}

/**
 * Import specifiers in a file. A match preceded by a quote on the same line is
 * inside a string literal (test fixtures), not a real import, and is skipped.
 */
export function importsOf(file, source, exists) {
  const out = new Set();
  for (const line of source.split("\n")) {
    for (const m of line.matchAll(SPECIFIER)) {
      if (/["'`]/.test(line.slice(0, m.index))) continue;
      const resolved = resolveImport(file, m[1], exists);
      if (resolved) out.add(resolved);
    }
  }
  return [...out];
}

/** Map each test file to every repo file it imports, directly or transitively. */
export function buildTestClosure(allFiles, read) {
  const known = new Set(allFiles);
  const exists = (f) => known.has(f);
  const direct = new Map(allFiles.map((f) => [f, importsOf(f, read(f), exists)]));
  const closure = new Map();
  for (const test of allFiles.filter(isTest)) {
    const seen = new Set();
    const stack = [test];
    while (stack.length > 0) {
      for (const dep of direct.get(stack.pop())) {
        if (!seen.has(dep)) {
          seen.add(dep);
          stack.push(dep);
        }
      }
    }
    closure.set(test, seen);
  }
  return closure;
}

export function relatedTests(sourceFiles, closure) {
  const wanted = new Set(sourceFiles);
  return [...closure.entries()]
    .filter(([, deps]) => [...deps].some((d) => wanted.has(d)))
    .map(([test]) => test)
    .sort();
}

export function planFromChangedFiles(files, closure) {
  if (files.length === 0) {
    return { mode: "skip", testFiles: [], mutateFiles: [], mutateTestFiles: [], reason: "no file changes detected", changed: files };
  }
  if (forceFull(files)) {
    return {
      mode: "full",
      testFiles: ["FULL"],
      mutateFiles: ["FULL"],
      mutateTestFiles: ["FULL"],
      reason: "dependencies, test harness, migrations, or mutation/coverage tooling changed",
      changed: files,
    };
  }
  const sources = files.filter(isSource);
  const testFiles = [...new Set([...files.filter(isTest), ...relatedTests(sources, closure)])].sort();
  const mutateFiles = sources.filter(isMutateTarget).sort();
  const mutateTestFiles = relatedTests(mutateFiles, closure);
  if (testFiles.length === 0 && mutateFiles.length === 0) {
    return {
      mode: "skip",
      testFiles: [],
      mutateFiles: [],
      mutateTestFiles: [],
      reason: "no src/ changes (docs, workflow YAML, gitignore, etc.)",
      changed: files,
    };
  }
  return { mode: "partial", testFiles, mutateFiles, mutateTestFiles, reason: "src changes: scoped tests and mutation", changed: files };
}

export const MAX_SHARDS = 6;

/**
 * Split mutate targets into at most `max` shards. A shard's runtime is roughly
 * (its mutants) x (the tests each mutant runs), so its cost is
 * sum(source size) x sum(test size), with size standing in for mutant count
 * and test time. Each file, most expensive first, goes to the shard it makes
 * cheapest. Each shard runs only the tests that import its files, the only
 * ones that can kill its mutants; a file no test imports makes its shard run
 * the whole suite (`tests: ""`).
 */
export function planShards(targets, closure, weight, max = MAX_SHARDS) {
  const count = Math.min(max, targets.length);
  const allTests = [...closure.keys()];
  const sum = (files) => files.reduce((n, f) => n + weight(f), 0);
  const testsOf = new Map(targets.map((f) => [f, relatedTests([f], closure)]));
  const cost = (files, tests, full) => sum(files) * sum(full ? allTests : [...tests]);
  const shards = Array.from({ length: count }, () => ({ files: [], tests: new Set(), full: false }));
  const alone = (f) => cost([f], testsOf.get(f), testsOf.get(f).length === 0);
  const ordered = [...targets].sort((a, b) => alone(b) - alone(a) || a.localeCompare(b));
  for (const file of ordered) {
    const own = testsOf.get(file);
    let best = shards[0];
    let bestCost = Infinity;
    for (const shard of shards) {
      const c = cost([...shard.files, file], new Set([...shard.tests, ...own]), shard.full || own.length === 0);
      if (c < bestCost) {
        best = shard;
        bestCost = c;
      }
    }
    best.files.push(file);
    for (const t of own) best.tests.add(t);
    best.full ||= own.length === 0;
  }
  return shards.map((shard, i) => ({
    name: `${i + 1}-of-${count}`,
    mutate: shard.files.sort().join(","),
    tests: shard.full ? "" : [...shard.tests].sort().join(" "),
  }));
}

export function shardTargets(plan, allFiles) {
  if (plan.mode === "full") return allFiles.filter(isMutateTarget).sort();
  if (plan.mode === "partial") return plan.mutateFiles;
  return [];
}

export function printMode(mode, plan) {
  const pick = (list, sep) => (plan.mode === "skip" ? "" : plan.mode === "full" ? "FULL" : list.join(sep));
  const outputs = {
    plan: () => JSON.stringify(plan, null, 2),
    tests: () => pick(plan.testFiles, "\n"),
    mutate: () => pick(plan.mutateFiles, ","),
    "mutate-tests": () => pick(plan.mutateTestFiles, "\n"),
  };
  if (!outputs[mode]) return { code: 2, text: `unknown mode: ${mode}` };
  return { code: 0, text: outputs[mode]() };
}

function sh(cmd) {
  return execSync(cmd, { encoding: "utf8" }).trim();
}

export function diffRange(env, run = sh) {
  if (env.GITHUB_EVENT_NAME === "pull_request" && env.GITHUB_BASE_REF) {
    return `${run(`git merge-base origin/${env.GITHUB_BASE_REF} HEAD`)}...HEAD`;
  }
  const before = env.CI_BASE_SHA || env.GITHUB_EVENT_BEFORE || "";
  if (before && !/^0+$/.test(before)) return `${before}...${env.CI_HEAD_SHA || "HEAD"}`;
  return `${run("git merge-base origin/main HEAD")}...HEAD`;
}

export function changedFiles(env, run = sh) {
  const out = run(`git diff --name-only --diff-filter=ACMR ${diffRange(env, run)}`);
  return out ? out.split("\n").filter(Boolean) : [];
}

export function repoFiles(run = sh) {
  return run("git ls-files -co --exclude-standard src scripts").split("\n").filter(Boolean);
}

export function main(
  argv,
  env,
  {
    run = sh,
    read = (f) => fs.readFileSync(f, "utf8"),
    exists = fs.existsSync,
    weight = (f) => fs.statSync(f).size,
  } = {},
) {
  const mode = (argv[2] || "plan").replace(/^mode=/, "");
  const all = repoFiles(run).filter((f) => exists(f));
  const closure = buildTestClosure(all, read);
  const plan = planFromChangedFiles(changedFiles(env, run), closure);
  if (mode === "shards") {
    return { code: 0, text: JSON.stringify(planShards(shardTargets(plan, all), closure, weight)) };
  }
  return printMode(mode, plan);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const { code, text } = main(process.argv, process.env);
  (code === 0 ? console.log : console.error)(text);
  process.exit(code);
}
