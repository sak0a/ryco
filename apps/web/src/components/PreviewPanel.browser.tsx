import "../index.css";

import { EnvironmentId, ProjectId, ThreadId } from "@ryco/contracts";
import { page } from "vitest/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render } from "vitest-browser-react";

import PreviewPanel from "./PreviewPanel";
import { PREVIEW_FILE_SIZE_LIMIT_BYTES } from "./PreviewPanel.logic";

const previewHarness = vi.hoisted(() => {
  type Entry = {
    readonly path: string;
    readonly kind: "file" | "directory";
    readonly sizeBytes?: number;
    readonly mimeType?: string;
  };
  type ReadFileResult = {
    readonly relativePath: string;
    readonly contents?: string;
    readonly base64?: string;
    readonly mimeType?: string;
  };
  type DraftThreadStub = {
    readonly threadId: string;
    readonly environmentId: string;
    readonly projectId: string;
    readonly worktreePath: string | null;
  };
  type Params = {
    readonly environmentId?: string;
    readonly threadId?: string;
    readonly draftId?: string;
  };

  return {
    entries: [] as Entry[],
    readFiles: new Map<string, ReadFileResult>(),
    readAttempts: [] as string[],
    serverThreadEnabled: true,
    draftThread: null as DraftThreadStub | null,
    routeParams: { environmentId: "environment-local", threadId: "thread-1" } as Params,
    reset() {
      this.entries = [];
      this.readFiles = new Map();
      this.readAttempts = [];
      this.serverThreadEnabled = true;
      this.draftThread = null;
      this.routeParams = { environmentId: "environment-local", threadId: "thread-1" };
    },
  };
});

vi.mock("@pierre/diffs", () => ({
  getSharedHighlighter: vi.fn().mockResolvedValue({
    codeToHtml: (contents: string) =>
      `<pre><code>${contents
        .split("\n")
        .map((line) => `<span class="line">${line}</span>`)
        .join("\n")}</code></pre>`,
  }),
}));

vi.mock("@tanstack/react-query", () => ({
  useQuery: vi.fn((options: { queryKey: readonly unknown[]; enabled?: boolean }) => {
    const queryKind = options.queryKey[1];
    if (queryKind === "listEntries") {
      return {
        data: { entries: previewHarness.entries, truncated: false },
        error: null,
        isLoading: false,
        isFetching: false,
        refetch: vi.fn().mockResolvedValue({
          data: { entries: previewHarness.entries, truncated: false },
        }),
      };
    }

    const relativePath = options.queryKey[4] as string | null;
    if (options.enabled !== false && relativePath) {
      previewHarness.readAttempts.push(relativePath);
    }
    return {
      data: relativePath ? previewHarness.readFiles.get(relativePath) : undefined,
      error: null,
      isLoading: false,
      isFetching: false,
      refetch: vi.fn().mockResolvedValue({
        data: relativePath ? previewHarness.readFiles.get(relativePath) : undefined,
      }),
    };
  }),
}));

vi.mock("@tanstack/react-router", () => ({
  useParams: vi.fn((options?: { select?: (params: Record<string, string>) => unknown }) => {
    const params = previewHarness.routeParams;
    return options?.select ? options.select(params) : params;
  }),
  useSearch: vi.fn((options?: { select?: (search: Record<string, string>) => unknown }) => {
    const search = { preview: "1" };
    return options?.select ? options.select(search) : search;
  }),
}));

vi.mock("../environmentApi", () => ({
  ensureEnvironmentApi: () => ({
    projects: {
      listEntries: vi.fn().mockResolvedValue({
        entries: previewHarness.entries,
        truncated: false,
      }),
      readFile: vi.fn(),
      stageFileReference: vi.fn(),
    },
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
    timestampFormat: "locale",
  }),
}));

vi.mock("../storeSelectors", () => ({
  createThreadSelectorByRef: () => () =>
    previewHarness.serverThreadEnabled
      ? {
          id: ThreadId.make("thread-1"),
          environmentId: EnvironmentId.make("environment-local"),
          projectId: ProjectId.make("project-1"),
          worktreePath: null,
          turnDiffSummaries: [],
        }
      : undefined,
}));

vi.mock("../store", () => ({
  selectProjectByRef: () => ({
    cwd: "/repo",
  }),
  useStore: (selector: (store: Record<string, never>) => unknown) => selector({}),
}));

vi.mock("../composerDraftStore", () => ({
  DraftId: { make: (value: string) => value },
  useComposerDraftStore: (
    selector: (store: {
      getDraftSession: (id: string) => unknown;
      getDraftThreadByRef: (ref: { environmentId: string; threadId: string }) => unknown;
    }) => unknown,
  ) =>
    selector({
      getDraftSession: () => previewHarness.draftThread,
      getDraftThreadByRef: () => previewHarness.draftThread,
    }),
}));

vi.mock("./chat/ChangedFilesTree", () => ({
  ChangedFilesTree: (props: {
    files: readonly { readonly path: string }[];
    onSelectFile: (path: string) => void;
  }) => (
    <div>
      {props.files.map((file) => (
        <button key={file.path} type="button" onClick={() => props.onSelectFile(file.path)}>
          {file.path}
        </button>
      ))}
    </div>
  ),
}));

describe("PreviewPanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(() => {
    previewHarness.reset();
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
    previewHarness.reset();
  });

  it("renders image previews from base64 file content", async () => {
    previewHarness.entries = [
      { path: "assets/logo.png", kind: "file", mimeType: "image/png", sizeBytes: 128 },
    ];
    previewHarness.readFiles.set("assets/logo.png", {
      relativePath: "assets/logo.png",
      base64:
        "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      mimeType: "image/png",
    });

    mounted = await render(<PreviewPanel mode="sheet" />);
    await page.getByRole("button", { name: "assets/logo.png" }).click();

    const image = page.getByRole("img", { name: "assets/logo.png" });
    await expect.element(image).toBeInTheDocument();
    await expect
      .element(image)
      .toHaveAttribute(
        "src",
        "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/p9sAAAAASUVORK5CYII=",
      );
  });

  it("renders text previews through syntax-highlighted output", async () => {
    previewHarness.entries = [{ path: "src/app.ts", kind: "file", sizeBytes: 64 }];
    previewHarness.readFiles.set("src/app.ts", {
      relativePath: "src/app.ts",
      contents: "const answer = 42;",
    });

    mounted = await render(<PreviewPanel mode="sheet" />);
    await page.getByRole("button", { name: "src/app.ts" }).click();

    await expect.element(page.getByText("const answer = 42;")).toBeInTheDocument();
  });

  it("shows a size warning and skips fetching oversized files", async () => {
    previewHarness.entries = [
      {
        path: "logs/huge.log",
        kind: "file",
        sizeBytes: PREVIEW_FILE_SIZE_LIMIT_BYTES + 1,
      },
    ];

    mounted = await render(<PreviewPanel mode="sheet" />);
    await page.getByRole("button", { name: "logs/huge.log" }).click();

    await expect.element(page.getByText(/File is too large to preview/)).toBeInTheDocument();
    expect(previewHarness.readAttempts).not.toContain("logs/huge.log");
  });

  it("falls back to the draft store on the draft route URL", async () => {
    previewHarness.serverThreadEnabled = false;
    previewHarness.routeParams = { draftId: "draft-1" };
    previewHarness.draftThread = {
      threadId: "thread-1",
      environmentId: "environment-local",
      projectId: "project-1",
      worktreePath: null,
    };
    previewHarness.entries = [{ path: "src/app.ts", kind: "file", sizeBytes: 64 }];
    previewHarness.readFiles.set("src/app.ts", {
      relativePath: "src/app.ts",
      contents: "const draft = true;",
    });

    mounted = await render(<PreviewPanel mode="sheet" />);
    await page.getByRole("button", { name: "src/app.ts" }).click();

    await expect.element(page.getByText("const draft = true;")).toBeInTheDocument();
  });
});
