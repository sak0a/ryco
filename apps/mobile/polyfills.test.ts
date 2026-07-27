import { describe, expect, it, vi } from "vitest";

import { installArrayCompatibilityPolyfills } from "./polyfills";

describe("mobile Hermes compatibility polyfills", () => {
  it("installs non-mutating array sort and reverse methods when they are missing", () => {
    const prototype: {
      toSorted?: (
        this: ReadonlyArray<unknown>,
        compareFn?: (left: unknown, right: unknown) => number,
      ) => Array<unknown>;
      toReversed?: (this: ReadonlyArray<unknown>) => Array<unknown>;
    } = {};

    installArrayCompatibilityPolyfills(prototype);

    const values = [3, 1, 2];
    expect(prototype.toSorted?.call(values, (left, right) => Number(left) - Number(right))).toEqual(
      [1, 2, 3],
    );
    expect(prototype.toReversed?.call(values)).toEqual([2, 1, 3]);
    expect(values).toEqual([3, 1, 2]);
    expect(Object.keys(prototype)).toEqual([]);
  });

  it("keeps native implementations when Hermes provides them", () => {
    const toSorted = vi.fn(() => ["native-sort"]);
    const toReversed = vi.fn(() => ["native-reverse"]);
    const prototype = { toSorted, toReversed };

    installArrayCompatibilityPolyfills(prototype);

    expect(prototype.toSorted).toBe(toSorted);
    expect(prototype.toReversed).toBe(toReversed);
  });
});
