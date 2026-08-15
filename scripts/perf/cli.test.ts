import { assert, describe, it } from "@effect/vitest";

import { parseArgs } from "./cli.ts";

describe("external performance CLI", () => {
  it("parses comparison refs and scenario values", () => {
    const parsed = parseArgs([
      "compare-refs",
      "--base",
      "origin/main",
      "--candidate",
      "HEAD",
      "--iterations",
      "7",
    ]);
    assert.equal(parsed.command, "compare-refs");
    assert.equal(parsed.values.get("base"), "origin/main");
    assert.equal(parsed.values.get("candidate"), "HEAD");
    assert.equal(parsed.values.get("iterations"), "7");
  });

  it("rejects unknown commands and missing option values", () => {
    assert.throws(() => parseArgs(["unknown"]), /Unknown command/u);
    assert.throws(() => parseArgs(["run", "--iterations"]), /requires a value/u);
    assert.throws(() => parseArgs(["run", "--mystery", "value"]), /Unknown option/u);
  });
});
