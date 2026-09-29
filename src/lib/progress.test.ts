import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { STATUS_LABEL, overallProgress, progressText, sectionStatus } from "./progress";

describe("sectionStatus", () => {
  it("is not started with nothing checked off and no entries", () => {
    assert.equal(sectionStatus({ items: 5, resolved: 0, entries: 0 }), "not_started");
    assert.equal(sectionStatus({ items: 0, resolved: 0, entries: 0 }), "not_started");
  });

  it("is in progress once anything is checked off or recorded", () => {
    assert.equal(sectionStatus({ items: 5, resolved: 1, entries: 0 }), "in_progress");
    assert.equal(sectionStatus({ items: 5, resolved: 0, entries: 1 }), "in_progress");
    assert.equal(sectionStatus({ items: 5, resolved: 4, entries: 3 }), "in_progress");
  });

  it("is complete only when every checklist item is Done or Skipped", () => {
    assert.equal(sectionStatus({ items: 5, resolved: 5, entries: 0 }), "complete");
    assert.equal(sectionStatus({ items: 5, resolved: 5, entries: 2 }), "complete");
    assert.equal(sectionStatus({ items: 1, resolved: 1, entries: 0 }), "complete");
  });

  it("never completes a section without checklist items, however many entries", () => {
    assert.equal(sectionStatus({ items: 0, resolved: 0, entries: 4 }), "in_progress");
  });
});

describe("overallProgress", () => {
  it("is zero for no sections or none complete", () => {
    assert.deepEqual(overallProgress([]), { total: 0, complete: 0, inProgress: 0, percent: 0 });
    assert.deepEqual(overallProgress(["not_started", "in_progress"]), {
      total: 2,
      complete: 0,
      inProgress: 1,
      percent: 0,
    });
  });

  it("matches the completed section count, rounded to a whole percent", () => {
    const twelve = (complete: number, inProgress = 0) => [
      ...Array<"complete">(complete).fill("complete"),
      ...Array<"in_progress">(inProgress).fill("in_progress"),
      ...Array<"not_started">(12 - complete - inProgress).fill("not_started"),
    ];
    assert.deepEqual(overallProgress(twelve(1)), { total: 12, complete: 1, inProgress: 0, percent: 8 });
    assert.deepEqual(overallProgress(twelve(3, 2)), { total: 12, complete: 3, inProgress: 2, percent: 25 });
    assert.equal(overallProgress(twelve(7)).percent, 58);
    assert.equal(overallProgress(twelve(12)).percent, 100);
    assert.equal(overallProgress(["complete", "not_started", "not_started"]).percent, 33);
    assert.equal(overallProgress(["complete", "complete", "not_started"]).percent, 67);
  });
});

describe("labels", () => {
  it("names each status in plain words", () => {
    assert.deepEqual(STATUS_LABEL, { not_started: "Not started", in_progress: "In progress", complete: "Complete" });
  });

  it("describes progress for screen readers", () => {
    assert.equal(progressText({ total: 12, complete: 3, inProgress: 1, percent: 25 }), "25% — 3 of 12 sections complete");
  });
});
