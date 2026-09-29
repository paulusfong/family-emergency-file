import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

const css = fs.readFileSync(path.join(import.meta.dirname, "globals.css"), "utf8").replace(/\/\*[\s\S]*?\*\//g, "");

/** Every declaration block whose selector list includes `selector`. */
function blocksFor(selector: string) {
  return [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter(([, selectors]) => selectors.split(",").some((s) => s.trim() === selector))
    .map(([, , body]) => body);
}

describe("QA-5: entry form layout on a 390px phone", () => {
  it("keeps the Save/Done/status row in normal flow, so it cannot cover a field", () => {
    const blocks = blocksFor(".form-actions");
    assert.equal(blocks.length, 1);
    assert.doesNotMatch(blocks.join(""), /position\s*:\s*(sticky|fixed|absolute)/);
    assert.equal(/\.form-actions[^{]*\{[^}]*position/.test(css), false);
  });

  it("pads the form while the fixed toast shows, so the last field can scroll clear of it", () => {
    assert.match(blocksFor(".toast").join(""), /position\s*:\s*fixed/);
    assert.match(blocksFor(".entry-form.has-toast").join(""), /padding-bottom\s*:\s*6\.5rem/);
  });
});
