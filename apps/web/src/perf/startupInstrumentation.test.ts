import { describe, expect, it } from "vitest";

import { makeStartupMarkName } from "./startupInstrumentation";

describe("startupInstrumentation", () => {
  it("uses a stable startup mark prefix", () => {
    expect(makeStartupMarkName("primary-shell-snapshot-applied")).toBe(
      "ryco:startup:primary-shell-snapshot-applied",
    );
  });
});
