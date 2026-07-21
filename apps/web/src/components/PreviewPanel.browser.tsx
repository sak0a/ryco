import "../index.css";

import { EnvironmentId, ProjectId, ThreadId } from "@ryco/contracts";
import { page } from "vite-plus/test/browser";
import { afterEach, beforeEach, describe, expect, it, vi } from "vite-plus/test";
import { render } from "vitest-browser-react";

import { AppAtomRegistryProvider, resetAppAtomRegistryForTests } from "../rpc/atomRegistry";
import { resetProjectPreviewAtomsForTests } from "../rpc/projectPreviewAtoms";
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

vi.mock("@pierre/diffs/react", () => ({
  File: (props: { file: { contents: string } }) => (
    <pre>
      <code>{props.file.contents}</code>
    </pre>
  ),
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
      listEntries: vi.fn().mockImplementation(() =>
        Promise.resolve({
          entries: previewHarness.entries,
          truncated: false,
        }),
      ),
      readFile: vi.fn().mockImplementation(({ relativePath }: { relativePath: string }) => {
        previewHarness.readAttempts.push(relativePath);
        const result = previewHarness.readFiles.get(relativePath);
        if (!result) {
          return Promise.reject(new Error("ENOENT: no such file"));
        }
        return Promise.resolve(result);
      }),
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

function renderPreviewPanel() {
  return render(
    <AppAtomRegistryProvider>
      <PreviewPanel mode="sheet" />
    </AppAtomRegistryProvider>,
  );
}

describe("PreviewPanel", () => {
  let mounted:
    | (Awaited<ReturnType<typeof render>> & {
        cleanup?: () => Promise<void>;
        unmount?: () => Promise<void>;
      })
    | null = null;

  beforeEach(() => {
    previewHarness.reset();
    resetAppAtomRegistryForTests();
    resetProjectPreviewAtomsForTests();
  });

  afterEach(async () => {
    if (mounted) {
      const teardown = mounted.cleanup ?? mounted.unmount;
      await teardown?.call(mounted).catch(() => {});
    }
    mounted = null;
    document.body.innerHTML = "";
    previewHarness.reset();
    resetAppAtomRegistryForTests();
    resetProjectPreviewAtomsForTests();
  });

  it("places the workspace tree on the right and filters visible files", async () => {
    previewHarness.entries = [
      { path: "src", kind: "directory" },
      { path: "src/app.ts", kind: "file", sizeBytes: 64 },
      { path: "README.md", kind: "file", sizeBytes: 64 },
    ];

    mounted = await renderPreviewPanel();

    const contentPanel = document.querySelector("[data-preview-content-panel]");
    const fileRail = document.querySelector("[data-preview-file-rail]");
    expect(contentPanel).not.toBeNull();
    expect(fileRail).not.toBeNull();
    expect(
      contentPanel!.compareDocumentPosition(fileRail!) & Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();

    await expect.element(page.getByText("Open file")).toBeInTheDocument();
    await page.getByPlaceholder("Filter files...").fill("readme");

    await expect.element(page.getByRole("button", { name: "README.md" })).toBeInTheDocument();
    await expect.element(page.getByRole("button", { name: "src/app.ts" })).not.toBeInTheDocument();
  });

  it("hides and restores the workspace tree with a smooth rail collapse", async () => {
    previewHarness.entries = [
      { path: "src", kind: "directory" },
      { path: "src/app.ts", kind: "file", sizeBytes: 64 },
    ];

    mounted = await renderPreviewPanel();

    const fileRail = document.querySelector<HTMLElement>("[data-preview-file-rail]");
    expect(fileRail).not.toBeNull();
    expect(fileRail!.getBoundingClientRect().width).toBeGreaterThan(100);

    await page.getByRole("button", { name: "Hide workspace tree" }).click();

    await expect
      .element(page.getByRole("button", { name: "Show workspace tree" }))
      .toBeInTheDocument();
    expect(fileRail!.getAttribute("aria-hidden")).toBe("true");
    await vi.waitFor(() => {
      expect(fileRail!.getBoundingClientRect().width).toBeLessThanOrEqual(1);
    });

    await page.getByRole("button", { name: "Show workspace tree" }).click();

    await expect
      .element(page.getByRole("button", { name: "Hide workspace tree" }))
      .toBeInTheDocument();
    expect(fileRail!.getAttribute("aria-hidden")).toBeNull();
    await vi.waitFor(() => {
      expect(fileRail!.getBoundingClientRect().width).toBeGreaterThan(100);
    });
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

    mounted = await renderPreviewPanel();
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

    mounted = await renderPreviewPanel();
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

    mounted = await renderPreviewPanel();
    await page.getByRole("button", { name: "logs/huge.log" }).click();

    await expect.element(page.getByText(/File is too large to preview/)).toBeInTheDocument();
    expect(previewHarness.readAttempts).not.toContain("logs/huge.log");
  });

  it("pushes a full-width file view from the tree and returns with back on the phone surface", async () => {
    previewHarness.entries = [
      { path: "src", kind: "directory" },
      { path: "src/app.ts", kind: "file", sizeBytes: 64 },
    ];
    previewHarness.readFiles.set("src/app.ts", {
      relativePath: "src/app.ts",
      contents: "const answer = 42;",
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <PreviewPanel mode="phone" />
      </AppAtomRegistryProvider>,
    );

    // Single-pane phone arrangement: the tree renders full-width — no split
    // rail, no tree-visibility toggle, no side-by-side empty state.
    await expect.element(page.getByRole("button", { name: "src/app.ts" })).toBeInTheDocument();
    expect(document.querySelector("[data-preview-file-rail]")).toBeNull();
    expect(document.querySelector('[aria-label="Resize workspace tree"]')).toBeNull();
    expect(document.querySelector('[aria-label="Hide workspace tree"]')).toBeNull();
    expect(document.body.textContent).not.toContain("Open file");

    // Tapping a file pushes the full-width file view with a back affordance.
    await page.getByRole("button", { name: "src/app.ts" }).click();
    await expect.element(page.getByText("const answer = 42;")).toBeInTheDocument();
    const backButton = page.getByRole("button", { name: "Back to workspace tree" });
    await expect.element(backButton).toBeInTheDocument();
    expect(document.querySelector('[aria-label="Filter files"]')).toBeNull();

    // Back returns to the tree.
    await backButton.click();
    await expect.element(page.getByRole("button", { name: "src/app.ts" })).toBeInTheDocument();
    await expect.element(page.getByLabelText("Filter files")).toBeInTheDocument();
  });

  it("defaults preview wrap on for the phone surface and keeps the toggle live", async () => {
    previewHarness.entries = [{ path: "src/app.ts", kind: "file", sizeBytes: 64 }];
    previewHarness.readFiles.set("src/app.ts", {
      relativePath: "src/app.ts",
      contents: "const answer = 42;",
    });

    mounted = await render(
      <AppAtomRegistryProvider>
        <PreviewPanel mode="phone" />
      </AppAtomRegistryProvider>,
    );

    // Wrap defaults on for the phone presentation even though the settings
    // mock has diffWordWrap: false (same rationale as the phone diff surface).
    await expect
      .element(page.getByRole("button", { name: "Disable preview line wrapping" }))
      .toBeInTheDocument();

    // The toggle stays user-operable on the phone surface.
    await page.getByRole("button", { name: "Disable preview line wrapping" }).click();
    await expect
      .element(page.getByRole("button", { name: "Enable preview line wrapping" }))
      .toBeInTheDocument();
  });

  it("keeps the settings-driven preview wrap default on desktop presentations", async () => {
    previewHarness.entries = [{ path: "src/app.ts", kind: "file", sizeBytes: 64 }];

    mounted = await renderPreviewPanel();

    // diffWordWrap: false in the settings mock stays authoritative off-phone.
    await expect
      .element(page.getByRole("button", { name: "Enable preview line wrapping" }))
      .toBeInTheDocument();
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

    mounted = await renderPreviewPanel();
    await page.getByRole("button", { name: "src/app.ts" }).click();

    await expect.element(page.getByText("const draft = true;")).toBeInTheDocument();
  });
});
