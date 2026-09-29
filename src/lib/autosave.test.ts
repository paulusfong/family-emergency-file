import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { NETWORK_ERROR, createAutosaver, type AutosaveState, type SaveOutcome } from "./autosave";

type V = { label: string };

function fakeTimers() {
  const pending = new Map<number, () => void>();
  const delays: number[] = [];
  let cleared = 0;
  let n = 0;
  return {
    timers: {
      set: (fn: () => void, ms: number) => {
        delays.push(ms);
        pending.set(++n, fn);
        return n;
      },
      clear: (h: unknown) => {
        cleared++;
        pending.delete(h as number);
      },
    },
    fire() {
      const fns = [...pending.values()];
      pending.clear();
      for (const fn of fns) fn();
    },
    get size() {
      return pending.size;
    },
    get cleared() {
      return cleared;
    },
    delays,
  };
}

function deferred<T>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const tick = () => new Promise((r) => setImmediate(r));

function setup(opts: {
  save?: (v: V) => Promise<SaveOutcome>;
  persisted?: boolean;
  initial?: V;
  canSave?: (v: V) => boolean;
  delayMs?: number;
}) {
  const states: AutosaveState[] = [];
  const saves: V[] = [];
  const t = fakeTimers();
  const saver = createAutosaver<V>({
    initial: opts.initial ?? { label: "" },
    persisted: opts.persisted ?? false,
    canSave: opts.canSave,
    delayMs: opts.delayMs,
    timers: t.timers,
    onState: (s) => states.push(s),
    save: async (v) => {
      saves.push(v);
      return opts.save ? opts.save(v) : { ok: true };
    },
  });
  return { saver, states, saves, t };
}

describe("createAutosaver", () => {
  it("debounces edits and saves the latest value once", async () => {
    const { saver, states, saves, t } = setup({ delayMs: 50 });
    saver.schedule({ label: "a" });
    saver.schedule({ label: "ab" });
    assert.equal(t.size, 1);
    assert.equal(t.cleared, 1);
    assert.deepEqual(t.delays, [50, 50]);
    assert.deepEqual(states, [{ status: "pending" }, { status: "pending" }]);
    t.fire();
    await tick();
    assert.deepEqual(saves, [{ label: "ab" }]);
    assert.deepEqual(states.slice(2), [{ status: "saving" }, { status: "saved" }]);
  });

  it("defaults to an 800ms debounce", () => {
    const { saver, t } = setup({});
    saver.schedule({ label: "x" });
    assert.deepEqual(t.delays, [800]);
  });

  it("blocks saving while canSave is false", async () => {
    const { saver, states, saves, t } = setup({ canSave: (v) => v.label !== "" });
    saver.schedule({ label: "" });
    assert.equal(t.size, 0);
    await saver.flush();
    assert.deepEqual(saves, []);
    assert.deepEqual(states, [{ status: "blocked" }, { status: "blocked" }]);
  });

  it("clears a pending timer when an edit becomes unsaveable", () => {
    const { saver, t } = setup({ canSave: (v) => v.label !== "" });
    saver.schedule({ label: "x" });
    saver.schedule({ label: "" });
    assert.equal(t.size, 0);
    assert.equal(t.cleared, 1);
  });

  it("does not re-save an unchanged persisted value", async () => {
    const { saver, states, saves } = setup({ persisted: true, initial: { label: "same" } });
    await saver.flush();
    assert.deepEqual(saves, []);
    assert.deepEqual(states, [{ status: "saved" }]);
  });

  it("saves the initial value when it is not yet persisted", async () => {
    const { saver, saves } = setup({ initial: { label: "new" } });
    await saver.flush();
    assert.deepEqual(saves, [{ label: "new" }]);
    await saver.flush();
    assert.deepEqual(saves, [{ label: "new" }]);
  });

  it("flush cancels the timer and saves immediately", async () => {
    const { saver, saves, t } = setup({});
    saver.schedule({ label: "now" });
    await saver.flush();
    assert.equal(t.size, 0);
    assert.equal(t.cleared, 1);
    assert.deepEqual(saves, [{ label: "now" }]);
  });

  it("forgets a fired timer so a later flush does not clear it", async () => {
    const { saver, t } = setup({});
    saver.schedule({ label: "a" });
    t.fire();
    await tick();
    await saver.flush();
    assert.equal(t.cleared, 0);
  });

  it("turns a thrown save into a network error, then recovers on retry", async () => {
    let fail = true;
    const { saver, states, saves } = setup({
      save: async () => {
        if (fail) throw new TypeError("Failed to fetch");
        return { ok: true };
      },
    });
    saver.schedule({ label: "x" });
    await saver.flush();
    assert.deepEqual(states.at(-1), { status: "error", error: NETWORK_ERROR, fieldErrors: undefined });
    fail = false;
    await saver.flush();
    assert.equal(saves.length, 2);
    assert.deepEqual(states.at(-1), { status: "saved" });
    assert.match(NETWORK_ERROR, /aren't saved yet/);
  });

  it("reports server-side validation errors", async () => {
    const { saver, states } = setup({
      save: async () => ({ ok: false, error: "Fix it", fieldErrors: { last4: "bad" } }),
    });
    saver.schedule({ label: "x" });
    await saver.flush();
    assert.deepEqual(states.at(-1), { status: "error", error: "Fix it", fieldErrors: { last4: "bad" } });
  });

  it("serializes saves and saves edits made during a save afterwards", async () => {
    const gates = [deferred<SaveOutcome>(), deferred<SaveOutcome>()];
    let active = 0;
    let maxActive = 0;
    let call = 0;
    const { saver, states, saves } = setup({
      save: async () => {
        active++;
        maxActive = Math.max(maxActive, active);
        const res = await gates[call++].promise;
        active--;
        return res;
      },
    });
    saver.schedule({ label: "one" });
    const first = saver.flush();
    saver.schedule({ label: "two" });
    const second = saver.flush();
    assert.equal(second, first);
    gates[0].resolve({ ok: true });
    await tick();
    assert.deepEqual(saves, [{ label: "one" }, { label: "two" }]);
    gates[1].resolve({ ok: true });
    await first;
    assert.equal(maxActive, 1);
    assert.deepEqual(
      states.filter((s) => s.status !== "pending"),
      [{ status: "saving" }, { status: "saving" }, { status: "saved" }],
    );
  });

  it("retries the latest value after a failed save that had queued edits", async () => {
    const gate = deferred<SaveOutcome>();
    let call = 0;
    const { saver, states, saves } = setup({
      save: async () => (call++ === 0 ? gate.promise : { ok: true }),
    });
    saver.schedule({ label: "one" });
    const done = saver.flush();
    saver.schedule({ label: "two" });
    void saver.flush();
    gate.resolve({ ok: false, error: "boom" });
    await done;
    assert.deepEqual(saves, [{ label: "one" }, { label: "two" }]);
    assert.deepEqual(states.at(-1), { status: "saved" });
    assert.equal(states.some((s) => s.status === "error"), false);
  });

  it("surfaces a failed queued save once instead of retrying it in a loop", async () => {
    const gate = deferred<SaveOutcome>();
    let call = 0;
    const { saver, states, saves } = setup({
      // Calls after the first fail; the cap keeps a regression from spinning forever.
      save: async () => (call++ === 0 ? gate.promise : call > 5 ? { ok: true } : { ok: false, error: "down" }),
    });
    saver.schedule({ label: "one" });
    const done = saver.flush();
    saver.schedule({ label: "two" });
    void saver.flush();
    gate.resolve({ ok: true });
    await done;
    assert.deepEqual(saves, [{ label: "one" }, { label: "two" }]);
    assert.deepEqual(states.at(-1), { status: "error", error: "down", fieldErrors: undefined });
  });

  it("stops emitting and clears timers after dispose", async () => {
    const { saver, states, t } = setup({});
    saver.schedule({ label: "x" });
    const before = states.length;
    saver.dispose();
    assert.equal(t.size, 0);
    await saver.flush();
    assert.equal(states.length, before);
  });

  it("uses real timers by default", async () => {
    const saves: string[] = [];
    const saver = createAutosaver<V>({
      initial: { label: "" },
      persisted: false,
      delayMs: 1,
      onState: () => {},
      save: async (v) => {
        saves.push(v.label);
        return { ok: true };
      },
    });
    saver.schedule({ label: "a" });
    saver.schedule({ label: "b" });
    await new Promise((r) => setTimeout(r, 20));
    assert.deepEqual(saves, ["b"]);
  });
});
