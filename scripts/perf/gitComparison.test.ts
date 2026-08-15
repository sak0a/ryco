import { assert, describe, it } from "@effect/vitest";

import { REF_BUILD_ARGS } from "./gitComparison.ts";

describe("external Git revision comparison", () => {
  it("forces equivalent cold task execution for each revision", () => {
    assert.deepStrictEqual(REF_BUILD_ARGS, [
      "run",
      "build",
      "--force",
      "--filter=ryco-cli",
      "--filter=@ryco/web",
    ]);
  });
});
