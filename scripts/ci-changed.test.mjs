import assert from "node:assert/strict";
import { describe, it } from "node:test";
import {
  STRYKER_MUTATE,
  buildTestClosure,
  changedFiles,
  diffRange,
  forceFull,
  importsOf,
  isMutateTarget,
  isSource,
  isTest,
  main,
  planFromChangedFiles,
  planShards,
  printMode,
  shardTargets,
  relatedTests,
  resolveImport,
} from "./ci-changed.mjs";

const repo = {
  "src/lib/entries.ts": 'import { db } from "./db";\nimport type { X } from "./entry-fields";',
  "src/lib/entry-fields.ts": 'import { ENTRY_TYPES } from "./schema";',
  "src/lib/schema.ts": 'import { sql } from "drizzle-orm";',
  "src/lib/db.ts": 'import { createClient } from "@libsql/client";',
  "src/lib/auth.ts": 'import { db } from "./db";',
  "src/components/entry-editor.tsx": 'import { createAutosaver } from "@/lib/autosave";',
  "src/lib/autosave.ts": "export const x = 1;",
  "src/app/app/sections/actions.ts": 'import { findSection } from "@/lib/entries";',
  "src/app/app/sections/[key]/page.tsx": 'import { saveEntry } from "../actions";\nimport { EntryEditor } from "@/components/entry-editor";',
  "src/lib/entries.test.ts": 'const entries = await import("./entries");',
  "src/lib/autosave.test.ts": 'import { createAutosaver } from "./autosave";',
  "src/app/app/sections/actions.test.ts": 'mock.module("@/lib/auth", {});\nconst a = await import("./actions");\nconst p = await import("./[key]/page");',
  "src/components/entry-editor.test.ts": 'const { EntryEditor } = await import("./entry-editor");',
  "src/proxy.ts": "export function proxy() {}",
  "src/proxy.test.ts": 'import { proxy } from "./proxy";',
  "scripts/ci-changed.mjs": "",
  "scripts/ci-changed.test.mjs": 'import { main } from "./ci-changed.mjs";',
};
const files = Object.keys(repo);
const read = (f) => repo[f];
const closure = buildTestClosure(files, read);

describe("file classification", () => {
  it("separates tests, sources, and harness", () => {
    assert.equal(isTest("src/lib/entries.test.ts"), true);
    assert.equal(isTest("scripts/ci-changed.test.mjs"), true);
    assert.equal(isTest("docs/x.test.md"), false);
    assert.equal(isTest("src/lib/entries.ts"), false);
    assert.equal(isSource("src/lib/entries.ts"), true);
    assert.equal(isSource("src/components/entry-editor.tsx"), true);
    assert.equal(isSource("src/test/setup.mjs"), false);
    assert.equal(isSource("src/lib/entries.test.ts"), false);
    assert.equal(isSource("src/app/globals.css"), false);
    assert.equal(isSource("scripts/ci-changed.mjs"), false);
  });

  it("mirrors the Stryker mutate allowlist", () => {
    assert.equal(isMutateTarget("src/lib/entries.ts"), true);
    assert.equal(isMutateTarget("src/app/app/sections/actions.ts"), true);
    assert.equal(isMutateTarget("src/app/actions.ts"), true);
    assert.equal(isMutateTarget("src/proxy.ts"), true);
    assert.equal(isMutateTarget("src/lib/entries.test.ts"), false);
    for (const f of ["src/lib/auth.ts", "src/lib/auth-client.ts", "src/lib/schema.ts", "src/lib/db.ts"]) {
      assert.equal(isMutateTarget(f), false, f);
      assert.ok(STRYKER_MUTATE.includes(`!${f}`), f);
    }
    assert.equal(isMutateTarget("src/components/entry-editor.tsx"), false);
    assert.equal(isMutateTarget("src/app/app/sections/[key]/page.tsx"), false);
    assert.equal(isMutateTarget("src/lib/view.tsx"), false);
    assert.deepEqual(STRYKER_MUTATE.slice(0, 5), [
      "src/lib/**/*.ts",
      "src/app/actions.ts",
      "src/app/app/sections/actions.ts",
      "src/proxy.ts",
      "!src/**/*.test.ts",
    ]);
  });

  it("forces the full suite for dependency, tooling, harness, and migration changes", () => {
    for (const f of [
      "package.json",
      "package-lock.json",
      "tsconfig.json",
      "stryker.config.mjs",
      ".c8rc.json",
      "scripts/coverage.mjs",
      "src/test/setup.mjs",
      "drizzle/0001_checklist_items.sql",
    ]) {
      assert.equal(forceFull([f]), true, f);
    }
    assert.equal(forceFull([".github/workflows/ci.yml", "README.md", ".gitignore", "src/lib/entries.ts"]), false);
  });
});

describe("import graph", () => {
  const exists = (f) => f in repo;

  it("resolves alias, relative, and extensionless specifiers", () => {
    assert.equal(resolveImport("src/app/x.ts", "@/lib/entries", exists), "src/lib/entries.ts");
    assert.equal(resolveImport("src/app/app/sections/[key]/page.tsx", "../actions", exists), "src/app/app/sections/actions.ts");
    assert.equal(resolveImport("scripts/ci-changed.test.mjs", "./ci-changed.mjs", exists), "scripts/ci-changed.mjs");
    assert.equal(resolveImport("src/lib/x.ts", "drizzle-orm", exists), null);
    assert.equal(resolveImport("src/lib/x.ts", "./missing", exists), null);
  });

  it("reads static, dynamic, type, and mock.module imports", () => {
    assert.deepEqual(importsOf("src/lib/entries.ts", repo["src/lib/entries.ts"], exists), [
      "src/lib/db.ts",
      "src/lib/entry-fields.ts",
    ]);
    assert.deepEqual(
      importsOf("src/app/app/sections/actions.test.ts", repo["src/app/app/sections/actions.test.ts"], exists),
      ["src/lib/auth.ts", "src/app/app/sections/actions.ts", "src/app/app/sections/[key]/page.tsx"],
    );
    assert.deepEqual(importsOf("a.ts", 'import x from "./a";\nimport y from "./a";', (f) => f === "a.ts"), ["a.ts"]);
    const fixture = [
      "const repo = {",
      `  "src/x.ts": 'import { db } from "./a";',`,
      "  note: `await import(\"./a\")`,",
      "};",
      "import {",
      "  real,",
      '} from "./b";',
      'const lazy = await import("./c");',
    ].join("\n");
    assert.deepEqual(importsOf("t.ts", fixture, (f) => ["a.ts", "b.ts", "c.ts"].includes(f)), ["b.ts", "c.ts"]);
  });

  it("finds tests that import a file transitively", () => {
    assert.deepEqual(relatedTests(["src/lib/autosave.ts"], closure), [
      "src/app/app/sections/actions.test.ts",
      "src/components/entry-editor.test.ts",
      "src/lib/autosave.test.ts",
    ]);
    assert.deepEqual(relatedTests(["src/lib/schema.ts"], closure), [
      "src/app/app/sections/actions.test.ts",
      "src/lib/entries.test.ts",
    ]);
    assert.deepEqual(relatedTests(["src/lib/nothing.ts"], closure), []);
    assert.equal(closure.has("src/lib/entries.ts"), false);
  });
});

describe("planFromChangedFiles", () => {
  it("skips when nothing changed or only non-src files changed", () => {
    assert.equal(planFromChangedFiles([], closure).mode, "skip");
    const docs = planFromChangedFiles([".github/workflows/ci.yml", "README.md"], closure);
    assert.equal(docs.mode, "skip");
    assert.deepEqual(docs.changed, [".github/workflows/ci.yml", "README.md"]);
    assert.deepEqual([docs.testFiles, docs.mutateFiles, docs.mutateTestFiles], [[], [], []]);
  });

  it("runs everything when tooling changed", () => {
    const plan = planFromChangedFiles(["src/lib/entries.ts", "package.json"], closure);
    assert.equal(plan.mode, "full");
    assert.deepEqual([plan.testFiles, plan.mutateFiles, plan.mutateTestFiles], [["FULL"], ["FULL"], ["FULL"]]);
    assert.match(plan.reason, /tooling/);
  });

  it("scopes tests and mutation to the changed sources", () => {
    const plan = planFromChangedFiles(["src/lib/entries.ts", "src/components/entry-editor.tsx"], closure);
    assert.equal(plan.mode, "partial");
    assert.deepEqual(plan.testFiles, [
      "src/app/app/sections/actions.test.ts",
      "src/components/entry-editor.test.ts",
      "src/lib/entries.test.ts",
    ]);
    assert.deepEqual(plan.mutateFiles, ["src/lib/entries.ts"]);
    assert.deepEqual(plan.mutateTestFiles, ["src/app/app/sections/actions.test.ts", "src/lib/entries.test.ts"]);
  });

  it("includes a changed test even when no source changed", () => {
    const plan = planFromChangedFiles(["src/proxy.test.ts"], closure);
    assert.equal(plan.mode, "partial");
    assert.deepEqual(plan.testFiles, ["src/proxy.test.ts"]);
    assert.deepEqual(plan.mutateFiles, []);
  });

  it("sorts mutate targets and still plans a source with no tests", () => {
    const plan = planFromChangedFiles(["src/proxy.ts", "src/lib/untested.ts"], closure);
    assert.deepEqual(plan.mutateFiles, ["src/lib/untested.ts", "src/proxy.ts"]);
    assert.deepEqual(plan.mutateTestFiles, ["src/proxy.test.ts"]);
  });
});

describe("printMode", () => {
  const partial = planFromChangedFiles(["src/lib/entries.ts", "src/proxy.ts"], closure);
  const full = planFromChangedFiles(["package.json"], closure);
  const skip = planFromChangedFiles(["README.md"], closure);

  it("prints lists for partial plans", () => {
    assert.deepEqual(printMode("tests", partial), {
      code: 0,
      text: "src/app/app/sections/actions.test.ts\nsrc/lib/entries.test.ts\nsrc/proxy.test.ts",
    });
    assert.deepEqual(printMode("mutate", partial), { code: 0, text: "src/lib/entries.ts,src/proxy.ts" });
    assert.equal(printMode("mutate-tests", partial).text.split("\n").length, 3);
    assert.deepEqual(JSON.parse(printMode("plan", partial).text), partial);
  });

  it("prints FULL and blanks for full and skip plans", () => {
    for (const mode of ["tests", "mutate", "mutate-tests"]) {
      assert.equal(printMode(mode, full).text, "FULL");
      assert.equal(printMode(mode, skip).text, "");
    }
  });

  it("rejects unknown modes", () => {
    assert.deepEqual(printMode("bogus", partial), { code: 2, text: "unknown mode: bogus" });
  });
});

describe("mutation shards", () => {
  const sizes = { "a.ts": 50, "b.ts": 40, "c.ts": 30, "d.ts": 20, "e.ts": 10 };
  const weight = (f) => sizes[f] ?? 1;
  const closureFor = new Map([
    ["a.test.ts", new Set(["a.ts"])],
    ["bc.test.ts", new Set(["b.ts", "c.ts"])],
  ]);

  it("balances files across shards, largest first onto the lightest shard", () => {
    const shards = planShards(["e.ts", "d.ts", "c.ts", "b.ts", "a.ts"], closureFor, weight, 2);
    assert.deepEqual(shards, [
      { name: "1-of-2", mutate: "a.ts,d.ts,e.ts", tests: "a.test.ts" },
      { name: "2-of-2", mutate: "b.ts,c.ts", tests: "bc.test.ts" },
    ]);
  });

  it("never makes more shards than files, caps at MAX_SHARDS, and breaks ties by name", () => {
    assert.deepEqual(planShards(["b.ts"], closureFor, weight), [{ name: "1-of-1", mutate: "b.ts", tests: "bc.test.ts" }]);
    assert.equal(planShards(["1", "2", "3", "4", "5", "6"], closureFor, () => 1).length, 4);
    assert.deepEqual(
      planShards(["y.ts", "x.ts"], closureFor, () => 1, 2).map((s) => s.mutate),
      ["x.ts", "y.ts"],
    );
    assert.deepEqual(planShards([], closureFor, weight), []);
    assert.deepEqual(planShards(["z.ts"], closureFor, weight)[0].tests, "");
  });

  it("targets every mutate target in full mode and only changed ones in partial mode", () => {
    const all = ["src/lib/entries.ts", "src/lib/db.ts", "src/proxy.ts", "src/app/page.tsx", "src/lib/x.test.ts"];
    assert.deepEqual(shardTargets({ mode: "full" }, all), ["src/lib/entries.ts", "src/proxy.ts"]);
    assert.deepEqual(shardTargets({ mode: "partial", mutateFiles: ["src/proxy.ts"] }, all), ["src/proxy.ts"]);
    assert.deepEqual(shardTargets({ mode: "skip" }, all), []);
  });
});

describe("git integration", () => {
  const fakeGit = (outputs) => {
    const calls = [];
    const run = (cmd) => {
      calls.push(cmd);
      const hit = Object.entries(outputs).find(([k]) => cmd.startsWith(k));
      return hit ? hit[1] : "";
    };
    return { run, calls };
  };

  it("diffs a pull request against its merge base", () => {
    const { run, calls } = fakeGit({ "git merge-base": "abc123" });
    assert.equal(diffRange({ GITHUB_EVENT_NAME: "pull_request", GITHUB_BASE_REF: "main" }, run), "abc123...HEAD");
    assert.deepEqual(calls, ["git merge-base origin/main HEAD"]);
  });

  it("diffs a push against the previous head", () => {
    const { run } = fakeGit({});
    assert.equal(diffRange({ GITHUB_EVENT_BEFORE: "def456" }, run), "def456...HEAD");
    assert.equal(diffRange({ CI_BASE_SHA: "a1", CI_HEAD_SHA: "b2" }, run), "a1...b2");
  });

  it("falls back to origin/main for new branches and local runs", () => {
    const { run, calls } = fakeGit({ "git merge-base": "m0" });
    assert.equal(diffRange({ GITHUB_EVENT_BEFORE: "0000000000000000000000000000000000000000" }, run), "m0...HEAD");
    assert.equal(diffRange({ GITHUB_EVENT_NAME: "pull_request" }, run), "m0...HEAD");
    assert.equal(diffRange({}, run), "m0...HEAD");
    assert.deepEqual(calls, Array(3).fill("git merge-base origin/main HEAD"));
  });

  it("lists changed files, ignoring blanks", () => {
    const { run, calls } = fakeGit({ "git merge-base": "m0", "git diff": "src/a.ts\n\nsrc/b.ts" });
    assert.deepEqual(changedFiles({}, run), ["src/a.ts", "src/b.ts"]);
    assert.equal(calls[1], "git diff --name-only --diff-filter=ACMR m0...HEAD");
    const empty = fakeGit({ "git merge-base": "m0" });
    assert.deepEqual(changedFiles({}, empty.run), []);
  });

  it("plans end to end from git output", () => {
    const { run } = fakeGit({
      "git merge-base": "m0",
      "git diff": "src/proxy.ts",
      "git ls-files": "src/proxy.ts\nsrc/proxy.test.ts\nsrc/gone.ts",
    });
    const readRepo = (f) => repo[f];
    assert.deepEqual(main(["node", "ci-changed.mjs", "mode=mutate"], {}, { run, read: readRepo }), {
      code: 0,
      text: "src/proxy.ts",
    });
    assert.deepEqual(main(["node", "ci-changed.mjs", "tests"], {}, { run, read: readRepo }), {
      code: 0,
      text: "src/proxy.test.ts",
    });
    assert.equal(JSON.parse(main(["node", "ci-changed.mjs"], {}, { run, read: readRepo }).text).mode, "partial");
  });

  it("emits a shard matrix from git output", () => {
    const { run } = fakeGit({
      "git merge-base": "m0",
      "git diff": "src/proxy.ts\nsrc/lib/autosave.ts",
      "git ls-files": files.join("\n"),
    });
    const out = main(["node", "ci-changed.mjs", "shards"], {}, {
      run,
      read,
      exists: (f) => f in repo,
      weight: (f) => repo[f].length,
    });
    assert.equal(out.code, 0);
    assert.deepEqual(JSON.parse(out.text), [
      { name: "1-of-2", mutate: "src/proxy.ts", tests: "src/proxy.test.ts" },
      {
        name: "2-of-2",
        mutate: "src/lib/autosave.ts",
        tests: "src/app/app/sections/actions.test.ts src/components/entry-editor.test.ts src/lib/autosave.test.ts",
      },
    ]);
    const full = fakeGit({ "git merge-base": "m0", "git diff": "package.json", "git ls-files": files.join("\n") });
    const shards = JSON.parse(
      main(["node", "x", "shards"], {}, { run: full.run, read, exists: (f) => f in repo, weight: () => 1 }).text,
    );
    assert.deepEqual(
      shards.flatMap((s) => s.mutate.split(",")).sort(),
      files.filter(isMutateTarget).sort(),
    );
  });
});
