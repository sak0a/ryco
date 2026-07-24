import { describe, expect, it, vi } from "vite-plus/test";

// BLOCKER 1: useHomeThreadGroups feeds two array-building selectors to zustand's
// useStore, which (v5, no equality arg) returns a fresh snapshot every render and
// infinite-loops the PRIMARY Home screen. The fix wraps BOTH selectors in
// useShallow. We mock the hook dependencies and invoke the real hook as a plain
// function to assert the wrapping without a React renderer (unavailable in node).

const shallowMock = vi.hoisted(() => ({ useShallow: vi.fn((selector: unknown) => selector) }));
vi.mock("zustand/react/shallow", () => shallowMock);

const runtimeMock = vi.hoisted(() => {
  const selectProjectsAcrossEnvironments = () => [];
  const selectSidebarThreadsAcrossEnvironments = () => [];
  return {
    selectProjectsAcrossEnvironments,
    selectSidebarThreadsAcrossEnvironments,
    useStore: vi.fn((selector: (state: unknown) => unknown) => selector({})),
  };
});
vi.mock("./threadsRuntime", () => runtimeMock);
vi.mock("./preferencesStore", () => ({ usePreferences: () => ({}) }));

import { useHomeThreadGroups } from "./homeData";

describe("Home store subscription stability (BLOCKER 1)", () => {
  it("wraps BOTH across-environment selectors in useShallow (prevents the fresh-array loop)", () => {
    shallowMock.useShallow.mockClear();
    const groups = useHomeThreadGroups();

    expect(shallowMock.useShallow).toHaveBeenCalledTimes(2);
    expect(shallowMock.useShallow).toHaveBeenCalledWith(
      runtimeMock.selectProjectsAcrossEnvironments,
    );
    expect(shallowMock.useShallow).toHaveBeenCalledWith(
      runtimeMock.selectSidebarThreadsAcrossEnvironments,
    );
    expect(groups).toEqual([]);
  });
});
