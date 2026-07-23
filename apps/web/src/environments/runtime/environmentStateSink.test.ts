import { describe, expect, it, vi } from "vite-plus/test";

const applyOrchestrationEvents = vi.fn();

vi.mock("~/store", () => ({
  useStore: { getState: () => ({ applyOrchestrationEvents }) },
  selectProjectsAcrossEnvironments: () => [],
  selectThreadsAcrossEnvironments: () => [],
}));
vi.mock("~/composerDraftStore", () => ({
  markPromotedDraftThreadsByRef: vi.fn(),
  useComposerDraftStore: {
    getState: () => ({ clearDraftThread: vi.fn(), clearProjectDraftThreadId: vi.fn() }),
  },
}));
vi.mock("~/hooks/useSettings", () => ({ getClientSettings: () => ({}) }));
vi.mock("~/logicalProject", () => ({
  deriveLogicalProjectKeyFromSettings: vi.fn(),
  derivePhysicalProjectKey: vi.fn(),
}));
vi.mock("~/terminalStateStore", () => ({
  useTerminalStateStore: { getState: () => ({ removeTerminalState: vi.fn() }) },
}));
vi.mock("~/uiStateStore", () => ({
  useUiStateStore: {
    getState: () => ({ syncProjects: vi.fn(), syncThreads: vi.fn(), clearThreadUi: vi.fn() }),
  },
}));

import { createWebEnvironmentStateSink } from "./environmentStateSink";

describe("web environment state sink", () => {
  it("maps orchestration application to the thread store with the environment id", () => {
    const sink = createWebEnvironmentStateSink({
      markProviderInvalidationNeeded: vi.fn(),
      flushProviderInvalidation: vi.fn(),
    });
    const events = [{ type: "thread.created" }] as never;

    sink.applyOrchestrationEvents("environment-a" as never, events);

    expect(applyOrchestrationEvents).toHaveBeenCalledWith(events, "environment-a");
  });
});
