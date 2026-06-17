import { describe, expect, it } from "vite-plus/test";
import {
  WEB_PERF_BUDGETS,
  evaluateMeasureDuration,
  evaluateSidebarExpandBudget,
  evaluateTabSwitchBudget,
  perfMarkNamesForKey,
  readPerformanceMeasureDurationMs,
  sidebarExpandMeasureName,
  tabSwitchMeasureName,
} from "./budgets";

describe("WEB_PERF_BUDGETS", () => {
  it("defines tab switch and sidebar expand ceilings", () => {
    expect(WEB_PERF_BUDGETS.tabSwitchMs).toBeGreaterThan(0);
    expect(WEB_PERF_BUDGETS.sidebarExpandMs).toBeGreaterThan(0);
  });
});

describe("evaluateMeasureDuration", () => {
  it("passes when duration is within budget", () => {
    expect(
      evaluateMeasureDuration({
        measureName: "ryco:tab-switch:env:thr_1",
        durationMs: 120,
        budgetMs: 400,
      }),
    ).toEqual({
      measureName: "ryco:tab-switch:env:thr_1",
      durationMs: 120,
      budgetMs: 400,
      withinBudget: true,
    });
  });

  it("fails when duration exceeds budget", () => {
    expect(
      evaluateMeasureDuration({
        measureName: "ryco:sidebar-expand:project-a",
        durationMs: 500,
        budgetMs: 350,
      }).withinBudget,
    ).toBe(false);
  });

  it("clamps negative durations to zero", () => {
    expect(
      evaluateMeasureDuration({
        measureName: "ryco:tab-switch:env:thr_1",
        durationMs: -10,
        budgetMs: 400,
      }).durationMs,
    ).toBe(0);
  });
});

describe("readPerformanceMeasureDurationMs", () => {
  it("returns the latest measure duration", () => {
    const entry = {
      duration: 48,
      entryType: "measure",
      name: "ryco:tab-switch:env:thr_1",
      startTime: 0,
      toJSON: () => ({}),
    } satisfies PerformanceEntry;
    const performanceObject = {
      getEntriesByName: () => [entry],
    } satisfies Pick<Performance, "getEntriesByName">;
    expect(readPerformanceMeasureDurationMs("ryco:tab-switch:env:thr_1", performanceObject)).toBe(
      48,
    );
  });

  it("returns null when no measure exists", () => {
    expect(
      readPerformanceMeasureDurationMs("ryco:tab-switch:missing", {
        getEntriesByName: () => [],
      }),
    ).toBeNull();
  });
});

describe("evaluateTabSwitchBudget", () => {
  it("evaluates the tab switch measure against the configured budget", () => {
    const entry = {
      duration: 180,
      entryType: "measure",
      name: tabSwitchMeasureName("env:thr_1"),
      startTime: 0,
      toJSON: () => ({}),
    } satisfies PerformanceEntry;
    const evaluation = evaluateTabSwitchBudget("env:thr_1", {
      getEntriesByName: (name) => (name === tabSwitchMeasureName("env:thr_1") ? [entry] : []),
    });
    expect(evaluation).toEqual({
      measureName: tabSwitchMeasureName("env:thr_1"),
      durationMs: 180,
      budgetMs: WEB_PERF_BUDGETS.tabSwitchMs,
      withinBudget: true,
    });
  });
});

describe("evaluateSidebarExpandBudget", () => {
  it("evaluates the sidebar expand measure against the configured budget", () => {
    const entry = {
      duration: 420,
      entryType: "measure",
      name: sidebarExpandMeasureName("project-a"),
      startTime: 0,
      toJSON: () => ({}),
    } satisfies PerformanceEntry;
    const evaluation = evaluateSidebarExpandBudget("project-a", {
      getEntriesByName: (name) => (name === sidebarExpandMeasureName("project-a") ? [entry] : []),
    });
    expect(evaluation?.withinBudget).toBe(false);
  });
});

describe("perfMarkNamesForKey", () => {
  it("aligns mark names with measure helpers", () => {
    expect(perfMarkNamesForKey("env:thr_1")).toEqual({
      tabSwitchClick: "ryco:tab-switch:click:env:thr_1",
      tabSwitchFirstPaint: "ryco:tab-switch:first-paint:env:thr_1",
      sidebarExpandClick: "ryco:sidebar-expand:click:env:thr_1",
      sidebarExpandFirstPaint: "ryco:sidebar-expand:first-paint:env:thr_1",
    });
  });
});
