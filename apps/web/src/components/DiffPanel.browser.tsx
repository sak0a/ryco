import "../index.css";

import { EnvironmentId, ProjectId, ThreadId } from "@ryco/contracts";
import type { ReactNode } from "react";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import DiffPanel from "./DiffPanel";

const openInPreferredEditor = vi.hoisted(() => vi.fn().mockResolvedValue(undefined));

const diffFile = {
  name: "b/src/app.ts",
  prevName: "a/src/app.ts",
  cacheKey: "src/app.ts",
  type: "change",
  additionLines: ["const alpha = 1;", "const beta = 2;"],
  deletionLines: ["const oldAlpha = 0;"],
};

vi.mock("@pierre/diffs", () => ({
  parsePatchFiles: vi.fn(() => [{ files: [diffFile] }]),
}));

vi.mock("@pierre/diffs/react", () => ({
  WorkerPoolContextProvider: (props: { children: ReactNode }) => <>{props.children}</>,
  useWorkerPool: () => null,
  Virtualizer: (props: { children: ReactNode }) => <div>{props.children}</div>,
  FileDiff: (props: {
    fileDiff: typeof diffFile;
    renderHeaderPrefix?: () => ReactNode;
    options: {
      onLineNumberClick?: (input: { lineNumber: number; lineType: string }) => void;
    };
  }) => (
    <div>
      <div data-title="">
        {props.renderHeaderPrefix?.()}
        {props.fileDiff.name}
      </div>
      <div data-line="">
        <button
          type="button"
          aria-label="Open added line 12"
          onClick={() =>
            props.options.onLineNumberClick?.({
              lineNumber: 12,
              lineType: "change-addition",
            })
          }
        >
          12
        </button>
        <mark>alpha</mark>
        <span> match</span>
      </div>
      <div data-line="">beta line</div>
    </div>
  ),
}));

vi.mock("../editorPreferences", () => ({
  openInPreferredEditor,
}));

vi.mock("@tanstack/react-router", () => ({
  useNavigate: () => vi.fn(),
  useParams: vi.fn((options?: { select?: (params: Record<string, string>) => unknown }) => {
    const params = { environmentId: "environment-local", threadId: "thread-1" };
    return options?.select ? options.select(params) : params;
  }),
  useSearch: vi.fn((options?: { select?: (search: Record<string, string>) => unknown }) => {
    const search = { diff: "1" };
    return options?.select ? options.select(search) : search;
  }),
}));

vi.mock("~/lib/gitStatusState", () => ({
  useGitStatus: () => ({ data: { isRepo: true } }),
}));

vi.mock("~/rpc/useProvider", () => ({
  useCheckpointDiff: () => ({
    data: { diff: "diff --git a/src/app.ts b/src/app.ts" },
    error: null,
    isLoading: false,
  }),
}));

vi.mock("../hooks/useTheme", () => ({
  useTheme: () => ({
    resolvedTheme: "light",
  }),
}));

vi.mock("../hooks/useSettings", () => ({
  useSettings: () => ({
    diffWordWrap: false,
    diffIgnoreWhitespace: false,
    timestampFormat: "locale",
  }),
}));

vi.mock("../hooks/useTurnDiffSummaries", () => ({
  useTurnDiffSummaries: () => ({
    turnDiffSummaries: [
      {
        turnId: "turn-1",
        checkpointTurnCount: 1,
        completedAt: "2026-05-06T00:00:00.000Z",
        files: [{ path: "src/app.ts" }],
      },
    ],
    inferredCheckpointTurnCountByTurnId: {},
  }),
}));

vi.mock("../threadRoutes", () => ({
  buildThreadRouteParams: () => ({ environmentId: "environment-local", threadId: "thread-1" }),
  resolveThreadRouteRef: () => ({
    environmentId: EnvironmentId.make("environment-local"),
    threadId: ThreadId.make("thread-1"),
  }),
}));

vi.mock("../storeSelectors", () => ({
  createThreadSelectorByRef: () => () => ({
    id: ThreadId.make("thread-1"),
    environmentId: EnvironmentId.make("environment-local"),
    projectId: ProjectId.make("project-1"),
    worktreePath: "/repo",
    turnDiffSummaries: [],
  }),
}));

vi.mock("../store", () => ({
  selectProjectByRef: () => ({
    cwd: "/repo",
  }),
  useStore: (selector: (store: Record<string, never>) => unknown) => selector({}),
}));

vi.mock("../localApi", () => ({
  readLocalApi: () => ({
    shell: {
      openInEditor: vi.fn(),
    },
  }),
}));

describe("DiffPanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(() => {
    openInPreferredEditor.mockClear();
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
    openInPreferredEditor.mockClear();
  });

  it("filters to search matches and cycles next results", async () => {
    mounted = await render(<DiffPanel mode="sheet" />);

    const search = page.getByLabelText("Search diff");
    await search.fill("beta");

    await expect.element(page.getByText("beta line")).toBeInTheDocument();
    await expect.element(page.getByText("1 of 1")).toBeInTheDocument();
    await page.getByRole("button", { name: "Next match" }).click();
    await expect.element(page.getByText("1 of 1")).toBeInTheDocument();
  });

  it("opens clicked line numbers in the preferred editor", async () => {
    mounted = await render(<DiffPanel mode="sheet" />);

    await page.getByRole("button", { name: "Open added line 12" }).click();

    await vi.waitFor(() => {
      expect(openInPreferredEditor).toHaveBeenCalledWith(expect.anything(), "/repo/src/app.ts:12");
    });
  });
});
