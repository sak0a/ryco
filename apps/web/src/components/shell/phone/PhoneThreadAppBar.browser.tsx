// Production CSS is part of the behavior under test: sheet row heights drive
// the touch-target assertions.
import "../../../index.css";

import { EnvironmentId, type ProjectId, type ThreadId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

const navigate = vi.fn(async () => undefined);
const routerStub = { navigate, state: { matches: [] } };
vi.mock("@tanstack/react-router", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@tanstack/react-router")>()),
  useNavigate: () => navigate,
  useRouter: () => routerStub,
}));

vi.mock("../../../lib/gitStatusState", () => ({
  useGitStatus: () => ({ data: null, error: null, cause: null, isPending: false }),
  useGitStatuses: () => new Map(),
  refreshGitStatus: () => Promise.resolve(null),
  resetGitStatusStateForTests: () => undefined,
}));

import { DraftId, useComposerDraftStore } from "../../../composerDraftStore";
import { syncDocumentPresentationTier } from "../../../lib/presentationTier";
import { SidebarProvider } from "../../ui/sidebar";
import { PhoneThreadAppBar } from "./PhoneThreadAppBar";

const ENV_ID = EnvironmentId.make("environment-local");
const DRAFT_ID = DraftId.make("draft-1");
const DRAFT_THREAD_ID = "thread-draft-1" as ThreadId;
const PROJECT_ID = "project-a" as ProjectId;
const NOW_ISO = "2026-07-20T00:00:00.000Z";

function seedDraft() {
  useComposerDraftStore.setState({
    draftThreadsByThreadKey: {
      [DRAFT_ID]: {
        threadId: DRAFT_THREAD_ID,
        environmentId: ENV_ID,
        projectId: PROJECT_ID,
        logicalProjectKey: `${ENV_ID}:${PROJECT_ID}`,
        createdAt: NOW_ISO,
        runtimeMode: "full-access",
        interactionMode: "default",
        branch: null,
        worktreePath: null,
        envMode: "local",
      },
    },
  });
}

function sheetRow(label: string): HTMLButtonElement | null {
  const popup = document.querySelector<HTMLElement>('[data-slot="sheet-popup"]');
  if (!popup) return null;
  return (
    [...popup.querySelectorAll<HTMLButtonElement>("button")].find(
      (button) => button.textContent?.trim() === label,
    ) ?? null
  );
}

function renderAppBar(onOpenFindInThread: () => void) {
  return render(
    <SidebarProvider>
      <PhoneThreadAppBar
        environmentId={ENV_ID}
        threadId={DRAFT_THREAD_ID}
        title="Empty Session"
        projectCwd="/repo/alpha"
        draft={{ draftId: DRAFT_ID, projectId: PROJECT_ID, createdAt: NOW_ISO }}
        workspacePanelOpen={false}
        onToggleWorkspacePanel={() => {}}
        onOpenFindInThread={onOpenFindInThread}
        sessionTabs={[]}
        activeSessionTabKey={null}
        onSelectSessionTab={null}
      />
    </SidebarProvider>,
  );
}

let mounted: Awaited<ReturnType<typeof render>> | null = null;

describe("PhoneThreadAppBar (draft thread)", () => {
  beforeAll(() => {
    syncDocumentPresentationTier();
  });

  beforeEach(async () => {
    await page.viewport(390, 844);
    localStorage.clear();
    navigate.mockClear();
    seedDraft();
  });

  afterEach(async () => {
    await mounted?.unmount();
    mounted = null;
    useComposerDraftStore.setState({ draftThreadsByThreadKey: {} });
    vi.restoreAllMocks();
    document.body.innerHTML = "";
    await page.viewport(1_280, 720);
  });

  it("exposes Close session for drafts in the kebab sheet and clears the draft through the shared dispatcher", async () => {
    mounted = await renderAppBar(() => {});

    await page.getByRole("button", { name: "Thread actions" }).click();
    const closeRow = await vi.waitFor(() => {
      const row = sheetRow("Close session");
      expect(row).not.toBeNull();
      return row!;
    });
    expect(closeRow.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    // The draft inventory is exactly the shared draft inventory: no
    // rename/pin/archive entries for a session that only exists locally.
    expect(sheetRow("Rename thread")).toBeNull();
    expect(sheetRow("Archive session")).toBeNull();

    closeRow.click();
    await vi.waitFor(() => {
      expect(useComposerDraftStore.getState().draftThreadsByThreadKey[DRAFT_ID]).toBeUndefined();
    });
  });

  it("keeps find-in-thread reachable from the kebab sheet", async () => {
    const onOpenFindInThread = vi.fn();
    mounted = await renderAppBar(onOpenFindInThread);

    await page.getByRole("button", { name: "Thread actions" }).click();
    const findRow = await vi.waitFor(() => {
      const row = sheetRow("Find in thread");
      expect(row).not.toBeNull();
      return row!;
    });
    expect(findRow.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
    findRow.click();
    expect(onOpenFindInThread).toHaveBeenCalledTimes(1);
  });
});
