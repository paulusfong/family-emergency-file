import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";
import { dismissLostSave, getLostSave, reportLostSave, subscribeLostSave } from "./lost-save";

describe("lost-save", () => {
  afterEach(() => dismissLostSave());

  it("holds the last reported lost save until dismissed", () => {
    assert.equal(getLostSave(), null);
    reportLostSave({ message: "one", href: null });
    reportLostSave({ message: "two", href: "/app/sections/S3/entries/e-1" });
    assert.deepEqual(getLostSave(), { message: "two", href: "/app/sections/S3/entries/e-1" });
    dismissLostSave();
    assert.equal(getLostSave(), null);
  });

  it("notifies every subscriber on report and dismiss, and stops after unsubscribe", () => {
    const seen: string[] = [];
    const offA = subscribeLostSave(() => seen.push(`a:${getLostSave()?.message ?? "none"}`));
    const offB = subscribeLostSave(() => seen.push(`b:${getLostSave()?.message ?? "none"}`));
    reportLostSave({ message: "x", href: null });
    offA();
    dismissLostSave();
    offB();
    reportLostSave({ message: "y", href: null });
    assert.deepEqual(seen, ["a:x", "b:x", "b:none"]);
  });
});
