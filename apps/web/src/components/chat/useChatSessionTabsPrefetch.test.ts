import { describe, expect, it } from "vite-plus/test";

import type { SessionTabItem } from "../../sessionTabs.selectors";
import {
  MAX_SPECULATIVE_SIBLING_TAB_PREFETCH,
  selectSpeculativeSiblingTabPrefetchKeys,
} from "./useChatSessionTabsPrefetch";

function tab(key: string): SessionTabItem {
  return {
    key,
    title: key,
    bucket: "idle",
  };
}

describe("selectSpeculativeSiblingTabPrefetchKeys", () => {
  it("caps speculative prefetch to nearby siblings around the active tab", () => {
    const tabs = Array.from({ length: 20 }, (_, index) => tab(`tab-${index}`));

    expect(selectSpeculativeSiblingTabPrefetchKeys(tabs, "tab-10")).toEqual([
      "tab-9",
      "tab-11",
      "tab-8",
      "tab-12",
      "tab-7",
      "tab-13",
    ]);
  });

  it("does not prefetch the active tab or more than the default cap", () => {
    const tabs = Array.from({ length: 30 }, (_, index) => tab(`tab-${index}`));
    const keys = selectSpeculativeSiblingTabPrefetchKeys(tabs, "tab-0");

    expect(keys).toHaveLength(MAX_SPECULATIVE_SIBLING_TAB_PREFETCH);
    expect(keys).not.toContain("tab-0");
    expect(keys).toEqual(["tab-1", "tab-2", "tab-3", "tab-4", "tab-5", "tab-6"]);
  });

  it("uses the first capped tabs when the active key is not in the sibling list", () => {
    const tabs = Array.from({ length: 10 }, (_, index) => tab(`tab-${index}`));

    expect(selectSpeculativeSiblingTabPrefetchKeys(tabs, "missing", 3)).toEqual([
      "tab-0",
      "tab-1",
      "tab-2",
    ]);
  });

  it("supports disabling speculative prefetch with a zero limit", () => {
    const tabs = [tab("tab-0"), tab("tab-1")];

    expect(selectSpeculativeSiblingTabPrefetchKeys(tabs, "tab-0", 0)).toEqual([]);
  });
});
