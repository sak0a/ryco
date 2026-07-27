import * as Option from "effect/Option";
import { describe, expect, it } from "vite-plus/test";

import { buildCheckSummary, optionText, type CheckRollupItemInput } from "./prCheckSummary";

function item(
  name: string,
  status: string | null,
  conclusion: string | null,
): CheckRollupItemInput {
  return {
    name,
    // Mirrors the wire shape: Schema.Option decodes to an Effect Option.
    status: status === null ? Option.none() : Option.some(status),
    conclusion: conclusion === null ? Option.none() : Option.some(conclusion),
  };
}

describe("optionText", () => {
  it("reads an Effect Option without treating None as a value", () => {
    // The trap: `Option.none() ?? null` is the None OBJECT, which is truthy.
    expect(optionText(Option.none())).toBeNull();
    expect(optionText(Option.some("success"))).toBe("success");
  });

  it("still accepts plain strings and nullish values", () => {
    expect(optionText("success")).toBe("success");
    expect(optionText(null)).toBeNull();
    expect(optionText(undefined)).toBeNull();
  });

  it("treats blank text as absent", () => {
    expect(optionText(Option.some("   "))).toBeNull();
    expect(optionText("  ")).toBeNull();
  });
});

describe("buildCheckSummary", () => {
  it("says unknown — not neutral — when the rollup could not be read", () => {
    const summary = buildCheckSummary({ available: false });
    expect(summary.state).toBe("unknown");
    expect(summary.countLabel).toBeNull();
    expect(summary.accessibilityLabel).toContain("could not read");
  });

  it("distinguishes no checks from could-not-find-out", () => {
    expect(buildCheckSummary({ available: true, items: [] }).state).toBe("none");
    expect(buildCheckSummary({ available: false, items: [] }).state).toBe("unknown");
    // A null item list is not an empty one.
    expect(buildCheckSummary({ available: true, items: null }).state).toBe("unknown");
  });

  it("counts completed over total", () => {
    const summary = buildCheckSummary({
      available: true,
      items: [
        item("a", "completed", "success"),
        item("b", "completed", "success"),
        item("c", "completed", "success"),
        item("d", "in_progress", null),
        item("e", null, null),
      ],
    });
    expect(summary.countLabel).toBe("3/5");
    expect(summary.completed).toBe(3);
    expect(summary.total).toBe(5);
  });

  it("does NOT call an unfinished run passing — the bug web has", () => {
    // Six queued, three green, nothing failed. Web renders this as success and
    // says "passing". It is not passing; it has not finished.
    const summary = buildCheckSummary({
      available: true,
      items: [
        item("a", "completed", "success"),
        item("b", "completed", "success"),
        item("c", "completed", "success"),
        ...Array.from({ length: 6 }, (_, i) => item(`q${i}`, "queued", null)),
      ],
    });
    expect(summary.state).toBe("queued");
    expect(summary.state).not.toBe("passed");
    expect(summary.label).toBe("Checks queued");
    expect(summary.countLabel).toBe("3/9");
  });

  it("separates running from queued", () => {
    expect(
      buildCheckSummary({
        available: true,
        items: [item("a", "in_progress", null), item("b", "queued", null)],
      }).state,
    ).toBe("running");
    expect(buildCheckSummary({ available: true, items: [item("b", "queued", null)] }).state).toBe(
      "queued",
    );
  });

  it("lets a single failure outrank everything still in flight", () => {
    const summary = buildCheckSummary({
      available: true,
      items: [
        item("a", "completed", "failure"),
        item("b", "in_progress", null),
        item("c", "completed", "success"),
      ],
    });
    expect(summary.state).toBe("failed");
    expect(summary.failed).toBe(1);
    expect(summary.label).toBe("1 failing");
  });

  it("treats every failing conclusion as a failure", () => {
    for (const conclusion of ["failure", "timed_out", "cancelled", "action_required"]) {
      expect(
        buildCheckSummary({ available: true, items: [item("a", "completed", conclusion)] }).state,
      ).toBe("failed");
    }
  });

  it("accepts neutral and skipped as passes", () => {
    const summary = buildCheckSummary({
      available: true,
      items: [
        item("a", "completed", "success"),
        item("b", "completed", "neutral"),
        item("c", "completed", "skipped"),
      ],
    });
    expect(summary.state).toBe("passed");
    expect(summary.label).toBe("Checks passed");
  });

  it("refuses to call an unrecognised conclusion a pass", () => {
    // A provider conclusion nobody has seen before must not fall into green.
    const summary = buildCheckSummary({
      available: true,
      items: [item("a", "completed", "some_new_thing")],
    });
    expect(summary.state).not.toBe("passed");
  });

  it("is case-insensitive about provider casing", () => {
    expect(
      buildCheckSummary({ available: true, items: [item("a", "COMPLETED", "SUCCESS")] }).state,
    ).toBe("passed");
  });

  it("only claims all-passed when every check really did", () => {
    const summary = buildCheckSummary({
      available: true,
      items: [item("a", "completed", "success"), item("b", "completed", "failure")],
    });
    expect(summary.state).toBe("failed");
    expect(summary.countLabel).toBe("2/2");
  });
});
