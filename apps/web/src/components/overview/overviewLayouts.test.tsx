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
    expect(markup).not.toContain('aria-expanded="true"');
  });

  it("renders glanceable metric tiles in the hybrid layout", () => {
    setPanelLayout("hybrid");
    const markup = renderToStaticMarkup(<PlanSidebar {...baseProps} />);
    expect(markup).toContain("grid-cols-4");
    expect(markup).toContain("Diff");
    expect(markup).toContain("Plan");
    expect(markup).not.toContain('aria-expanded="true"');
  });

  it("renders expandable lanes in the status board layout", () => {
    setPanelLayout("board");
    const markup = renderToStaticMarkup(<PlanSidebar {...baseProps} />);
    expect(markup).not.toContain('aria-expanded="true"');
    expect(markup).toContain('data-slot="overview-section-lane-header"');
    expect(markup).toContain("min-h-10");
    expect(markup).toContain("Changes");
    expect(markup).toContain("3 files");
  });

  it("renders environment metadata once without an empty disclosure", () => {
    setPanelLayout("board");
    const markup = renderToStaticMarkup(
      <PlanSidebar
        {...baseProps}
        activePlan={null}
        overviewItems={[
          { label: "Environment", value: "Local", detail: "local", icon: "environment" },
        ]}
      />,
    );

    expect(markup.match(/>Local</g)).toHaveLength(1);
    expect(markup).not.toContain(">local<");
    expect(markup).not.toContain(">Target<");
    expect(markup).not.toContain(">Status<");
    expect(markup).toContain('data-expandable="false"');
    expect(markup).not.toContain("aria-expanded");
  });

  it("keeps a distinct environment status visible once", () => {
    setPanelLayout("board");
    const markup = renderToStaticMarkup(
      <PlanSidebar
        {...baseProps}
        activePlan={null}
        overviewItems={[
          {
            label: "Environment",
            value: "Remote",
            detail: "disconnected",
            icon: "environment",
          },
        ]}
      />,
    );

    expect(markup.match(/>Remote</g)).toHaveLength(1);
    expect(markup.match(/>disconnected</g)).toHaveLength(1);
    expect(markup).toContain('data-expandable="false"');
    expect(markup).not.toContain("aria-expanded");
  });

  it("renders an independent pull request link only when a URL exists", () => {
    setPanelLayout("board");
    const pullRequest = {
      number: 264,
      title: "Make the status board compact",
      url: "https://github.com/ryco/ryco/pull/264",
      state: "open",
      checkStatus: null,
      checksLoading: false,
      hasMergeConflicts: true,
      activeCheckCount: 0,
      runs: [],
      latestRuns: [],
    };

    const markup = renderToStaticMarkup(<PlanSidebar {...baseProps} pullRequest={pullRequest} />);
    expect(markup).toContain("Pull Request #264");
    expect(markup).toContain('href="https://github.com/ryco/ryco/pull/264"');
    expect(markup).toContain('target="_blank"');
    expect(markup).toContain('rel="noreferrer"');
    expect(markup).toContain('aria-label="Open pull request #264 in a new tab"');
    expect(markup.match(/Make the status board compact/g)).toHaveLength(1);

    const { url: _url, ...pullRequestWithoutUrl } = pullRequest;
    const markupWithoutUrl = renderToStaticMarkup(
      <PlanSidebar {...baseProps} pullRequest={pullRequestWithoutUrl} />,
    );
    expect(markupWithoutUrl).not.toContain("Open pull request #264 in a new tab");
  });
});
