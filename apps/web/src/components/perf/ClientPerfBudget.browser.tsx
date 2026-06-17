import { describe, expect, it } from "vite-plus/test";

import {
  evaluateSidebarExpandBudget,
  evaluateTabSwitchBudget,
  perfMarkNamesForKey,
  WEB_PERF_BUDGETS,
} from "../../perf/budgets";

function recordInteractionMeasure(input: {
  measureName: string;
  startMark: string;
  endMark: string;
}): void {
  performance.mark(input.startMark);
  performance.mark(input.endMark);
  performance.measure(input.measureName, input.startMark, input.endMark);
}

describe("@perf client perf budgets", () => {
  it("evaluates tab switch measures against the configured budget in the browser", () => {
    const marks = perfMarkNamesForKey("env:thr_budget");
    recordInteractionMeasure({
      measureName: "ryco:tab-switch:env:thr_budget",
      startMark: marks.tabSwitchClick,
      endMark: marks.tabSwitchFirstPaint,
    });

    const evaluation = evaluateTabSwitchBudget("env:thr_budget");
    expect(evaluation).not.toBeNull();
    expect(evaluation?.budgetMs).toBe(WEB_PERF_BUDGETS.tabSwitchMs);
    expect(evaluation?.withinBudget).toBe(true);
  });

  it("evaluates sidebar expand measures against the configured budget in the browser", () => {
    const marks = perfMarkNamesForKey("project-budget");
    recordInteractionMeasure({
      measureName: "ryco:sidebar-expand:project-budget",
      startMark: marks.sidebarExpandClick,
      endMark: marks.sidebarExpandFirstPaint,
    });

    const evaluation = evaluateSidebarExpandBudget("project-budget");
    expect(evaluation).not.toBeNull();
    expect(evaluation?.budgetMs).toBe(WEB_PERF_BUDGETS.sidebarExpandMs);
    expect(evaluation?.withinBudget).toBe(true);
  });
});
