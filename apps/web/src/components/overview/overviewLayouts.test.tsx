import { EnvironmentId } from "@ryco/contracts";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, beforeEach, describe, expect, it } from "vite-plus/test";

import { APPEARANCE_PREFERENCES_STORAGE_KEY } from "../../themes/appearancePreferences";
import PlanSidebar from "../PlanSidebar";

class MemoryStorage implements Storage {
  private map = new Map<string, string>();
  get length(): number {
    return this.map.size;
  }
  clear(): void {
    this.map.clear();
  }
  getItem(key: string): string | null {
    return this.map.get(key) ?? null;
  }
  key(index: number): string | null {
    return Array.from(this.map.keys())[index] ?? null;
  }
  removeItem(key: string): void {
    this.map.delete(key);
  }
  setItem(key: string, value: string): void {
    this.map.set(key, value);
  }
}

function setPanelLayout(layout: string) {
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: new MemoryStorage(),
  });
  localStorage.setItem(APPEARANCE_PREFERENCES_STORAGE_KEY, JSON.stringify({ panelLayout: layout }));
}

const baseProps = {
  activePlan: {
    createdAt: "2026-06-30T00:00:00.000Z",
    turnId: null,
    explanation: "Rework the overview panel.",
    steps: [
      { step: "Audit sections", status: "completed" as const },
      { step: "Build layouts", status: "inProgress" as const },
    ],
  },
  activeProposedPlan: null,
  overviewItems: [
    { label: "Changes", value: "3 files", additions: 10, deletions: 2, icon: "changes" as const },
  ],
  environmentId: EnvironmentId.make("environment-local"),
  markdownCwd: undefined,
  workspaceRoot: undefined,
};

describe("overview panel layouts", () => {
  beforeEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  afterEach(() => {
    Reflect.deleteProperty(globalThis, "localStorage");
  });

  it("renders the stack layout by default (sticky metric strip, no tiles)", () => {
    const markup = renderToStaticMarkup(<PlanSidebar {...baseProps} />);
    expect(markup).toContain("Changes");
    expect(markup).toContain("Diff");
    expect(markup).not.toContain("grid-cols-2");
  });

  it("renders glanceable metric tiles in the hybrid layout", () => {
    setPanelLayout("hybrid");
    const markup = renderToStaticMarkup(<PlanSidebar {...baseProps} />);
    expect(markup).toContain("grid-cols-4");
    expect(markup).toContain("Diff");
    expect(markup).toContain("Plan");
  });

  it("renders expandable lanes in the status board layout", () => {
    setPanelLayout("board");
    const markup = renderToStaticMarkup(<PlanSidebar {...baseProps} />);
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain("Changes");
  });
});
