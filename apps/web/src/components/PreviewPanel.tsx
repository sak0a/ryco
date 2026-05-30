import { File as DiffsFile } from "@pierre/diffs/react";
import { useQuery } from "@tanstack/react-query";
import { useParams, useSearch } from "@tanstack/react-router";
import { Schema } from "effect";
import { CircleAlertIcon, RefreshCwIcon, TextWrapIcon, TriangleAlertIcon } from "lucide-react";
import {
  type CSSProperties,
  type PointerEvent as ReactPointerEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { ensureEnvironmentApi } from "../environmentApi";
import { parsePreviewRouteSearch } from "../previewRouteSearch";
import { fnv1a32, resolveDiffThemeName } from "../lib/diffRendering";
import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import type { TurnDiffSummary } from "../types";
import { ChangedFilesTree } from "./chat/ChangedFilesTree";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import { cn } from "~/lib/utils";
import {
  detectPreviewFileKind,
  inferPreviewLanguage,
  resolvePreviewSizeGuard,
} from "./PreviewPanel.logic";

const PREVIEW_TREE_WIDTH_STORAGE_KEY = "chat_preview_tree_width";
const PREVIEW_TREE_MIN_WIDTH = 220;
const PREVIEW_TREE_DEFAULT_WIDTH = 280;
const PREVIEW_TREE_MAX_RATIO = 0.55;
const PREVIEW_CODE_CSS = `
.preview-panel-diffs-file {
  display: block;
  min-height: 100%;
  background-color: color-mix(in srgb, var(--card) 90%, var(--background));
}
`;

const PREVIEW_FILE_UNSAFE_CSS = `
[data-file] {
  --diffs-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-light-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-dark-bg: color-mix(in srgb, var(--card) 90%, var(--background)) !important;
  --diffs-token-light-bg: transparent;
  --diffs-token-dark-bg: transparent;
  background-color: var(--diffs-bg) !important;
}

[data-content] {
  padding: 0.75rem;
}

[data-line],
[data-column-number] {
  font-size: 11px;
  line-height: 1.25rem;
}

[data-line-number-content] {
  color: color-mix(in srgb, var(--muted-foreground) 85%, transparent);
}
`;

type PreviewProjectEntryMetadata = {
  readonly sizeBytes?: number;
  readonly mimeType?: string;
};

type RichPreviewFileData = {
  readonly relativePath: string;
  readonly contents?: string;
  readonly base64?: string;
  readonly mimeType?: string;
};

function clampTreeWidth(width: number, containerWidth: number): number {
  const maxWidth = Math.max(
    PREVIEW_TREE_MIN_WIDTH,
    Math.floor(containerWidth * PREVIEW_TREE_MAX_RATIO),
  );
  return Math.max(PREVIEW_TREE_MIN_WIDTH, Math.min(width, maxWidth));
}

function getResizedTreeWidth(
  resizeState: { startWidth: number; startX: number },
  containerWidth: number,
  pointerClientX: number,
): number {
  const delta = pointerClientX - resizeState.startX;
  return clampTreeWidth(resizeState.startWidth + delta, containerWidth);
}

function isMissingWorkspaceFileError(message: string | null): boolean {
  if (!message) {
    return false;
  }
  const normalized = message.toLowerCase();
  return (
    normalized.includes("enoent") ||
    normalized.includes("no such file") ||
    normalized.includes("file not found") ||
    normalized.includes("cannot find the file")
  );
}

function buildPreviewFileCacheKey(filePath: string, contents: string): string {
  return `preview:${filePath}:${contents.length}:${fnv1a32(contents).toString(36)}`;
}

const EMPTY_TURN_DIFF_SUMMARIES: readonly TurnDiffSummary[] = [];

interface PreviewPanelProps {
  mode?: DiffPanelMode;
}

export default function PreviewPanel({ mode = "inline" }: PreviewPanelProps) {
  const { resolvedTheme } = useTheme();
  const settings = useSettings();
  const routeThreadRef = useParams({
    strict: false,
    select: (params) => resolveThreadRouteRef(params),
  });
  const routeDraftId = useParams({
    strict: false,
    select: (params) => (typeof params.draftId === "string" ? DraftId.make(params.draftId) : null),
  });
  const previewSearch = useSearch({
    strict: false,
    select: (search) => parsePreviewRouteSearch(search),
  });
  const serverThread = useStore(
    useMemo(() => createThreadSelectorByRef(routeThreadRef), [routeThreadRef]),
  );
  const draftThread = useComposerDraftStore((store) => {
    if (serverThread) return null;
    if (routeDraftId) return store.getDraftSession(routeDraftId);
    if (routeThreadRef) return store.getDraftThreadByRef(routeThreadRef);
    return null;
  });
  const activeThread = useMemo(() => {
    if (serverThread) {
      return {
        id: serverThread.id,
        environmentId: serverThread.environmentId,
        projectId: serverThread.projectId,
        worktreePath: serverThread.worktreePath,
        turnDiffSummaries: serverThread.turnDiffSummaries,
      };
    }
    if (draftThread) {
      return {
        id: draftThread.threadId,
        environmentId: draftThread.environmentId,
        projectId: draftThread.projectId,
        worktreePath: draftThread.worktreePath,
        turnDiffSummaries: EMPTY_TURN_DIFF_SUMMARIES,
      };
    }
    return undefined;
  }, [serverThread, draftThread]);
  const activeProjectId = activeThread?.projectId ?? null;
  const activeProject = useStore((store) =>
    activeThread && activeProjectId
      ? selectProjectByRef(store, {
          environmentId: activeThread.environmentId,
          projectId: activeProjectId,
        })
      : undefined,
  );
  const activeCwd = activeThread?.worktreePath ?? activeProject?.cwd ?? null;
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [wrapPreviewLines, setWrapPreviewLines] = useState(settings.diffWordWrap);
  const splitLayoutRef = useRef<HTMLDivElement | null>(null);
  const [treeWidth, setTreeWidth] = useState(() => {
    if (typeof window === "undefined") {
      return PREVIEW_TREE_DEFAULT_WIDTH;
    }
    return (
      getLocalStorageItem(PREVIEW_TREE_WIDTH_STORAGE_KEY, Schema.Finite) ??
      PREVIEW_TREE_DEFAULT_WIDTH
    );
  });
  const resizeStateRef = useRef<{
    pointerId: number;
    startWidth: number;
    startX: number;
  } | null>(null);
  const previousPreviewOpenRef = useRef(previewSearch.preview === "1");
  const previousProjectFilesRefreshKeyRef = useRef<string | null>(null);
  const previousSelectedFileRefreshKeyRef = useRef<string | null>(null);
  const missingFileRefreshKeyRef = useRef<string | null>(null);

  useEffect(() => {
    setWrapPreviewLines(settings.diffWordWrap);
  }, [settings.diffWordWrap]);

  useEffect(() => {
    setSelectedFilePath(null);
  }, [activeThread?.environmentId, activeThread?.id]);

  const latestProjectFilesRefreshKey = useMemo(() => {
    const latestChangedSummary = (activeThread?.turnDiffSummaries ?? [])
      .toReversed()
      .find((summary) => summary.files.length > 0);
    return latestChangedSummary
      ? `${latestChangedSummary.turnId}:${latestChangedSummary.completedAt}`
      : null;
  }, [activeThread?.turnDiffSummaries]);

  const latestSelectedFileRefreshKey = useMemo(() => {
    if (!selectedFilePath) return null;
    const latestSelectedFileSummary = (activeThread?.turnDiffSummaries ?? [])
      .toReversed()
      .find((summary) => summary.files.some((file) => file.path === selectedFilePath));
    return latestSelectedFileSummary
      ? `${latestSelectedFileSummary.turnId}:${latestSelectedFileSummary.completedAt}`
      : null;
  }, [activeThread?.turnDiffSummaries, selectedFilePath]);

  const projectFilesQuery = useQuery({
    queryKey: ["projects", "listEntries", activeThread?.environmentId ?? null, activeCwd],
    queryFn: async () => {
      if (!activeThread?.environmentId || !activeCwd) {
        throw new Error("Project tree is unavailable.");
      }
      const api = ensureEnvironmentApi(activeThread.environmentId);
      return api.projects.listEntries({ cwd: activeCwd });
    },
    enabled: Boolean(activeThread?.environmentId && activeCwd && previewSearch.preview === "1"),
    retry: 1,
    select: (result) => ({
      ...result,
      entries: result.entries.toSorted((left, right) =>
        left.path.localeCompare(right.path, undefined, { numeric: true, sensitivity: "base" }),
      ),
    }),
  });
  const projectFilesError =
    projectFilesQuery.error instanceof Error
      ? projectFilesQuery.error.message
      : projectFilesQuery.error
        ? "Failed to load the workspace tree."
        : null;
  const projectFiles = projectFilesQuery.data;
  const projectFilesTruncated = projectFilesQuery.data?.truncated === true;
  const projectFilesIsFetching = projectFilesQuery.isFetching;
  const refetchProjectFiles = projectFilesQuery.refetch;

  useEffect(() => {
    if (!projectFiles) {
      return;
    }
    if (projectFiles.entries.length === 0) {
      setSelectedFilePath(null);
      return;
    }
    if (selectedFilePath && !projectFiles.entries.some((file) => file.path === selectedFilePath)) {
      setSelectedFilePath(null);
    }
  }, [projectFiles, selectedFilePath]);

  useEffect(() => {
    if (previewSearch.preview !== "1") {
      previousProjectFilesRefreshKeyRef.current = latestProjectFilesRefreshKey;
      return;
    }
    if (previousProjectFilesRefreshKeyRef.current === null) {
      previousProjectFilesRefreshKeyRef.current = latestProjectFilesRefreshKey;
      return;
    }
    if (previousProjectFilesRefreshKeyRef.current === latestProjectFilesRefreshKey) {
      return;
    }
    previousProjectFilesRefreshKeyRef.current = latestProjectFilesRefreshKey;
    void refetchProjectFiles();
  }, [latestProjectFilesRefreshKey, previewSearch.preview, refetchProjectFiles]);

  useEffect(() => {
    const previewOpen = previewSearch.preview === "1";
    if (previewOpen && !previousPreviewOpenRef.current) {
      setSelectedFilePath(null);
    }
    previousPreviewOpenRef.current = previewOpen;
  }, [previewSearch.preview]);

  const selectedProjectEntry = selectedFilePath
    ? projectFiles?.entries.find((entry) => entry.path === selectedFilePath)
    : undefined;
  const selectedProjectEntryMetadata = selectedProjectEntry as
    | (typeof selectedProjectEntry & PreviewProjectEntryMetadata)
    | undefined;
  const selectedFileSizeGuard =
    typeof selectedProjectEntryMetadata?.sizeBytes === "number"
      ? resolvePreviewSizeGuard(selectedProjectEntryMetadata.sizeBytes)
      : null;

  const selectedFileQuery = useQuery({
    queryKey: [
      "projects",
      "readFile",
      activeThread?.environmentId ?? null,
      activeCwd,
      selectedFilePath,
    ],
    queryFn: async () => {
      if (!activeThread?.environmentId || !activeCwd || !selectedFilePath) {
        throw new Error("File preview is unavailable.");
      }
      const api = ensureEnvironmentApi(activeThread.environmentId);
      return api.projects.readFile({
        cwd: activeCwd,
        relativePath: selectedFilePath,
      });
    },
    enabled: Boolean(
      activeThread?.environmentId &&
      activeCwd &&
      selectedFilePath &&
      previewSearch.preview === "1" &&
      (selectedFileSizeGuard?.shouldFetch ?? true),
    ),
    retry: 1,
  });
  const selectedFileData =
    selectedFileQuery.data?.relativePath === selectedFilePath ? selectedFileQuery.data : null;
  const richSelectedFileData = selectedFileData as RichPreviewFileData | null;
  const selectedFileMimeType =
    richSelectedFileData?.mimeType ?? selectedProjectEntryMetadata?.mimeType ?? null;
  const selectedFileKind = selectedFilePath
    ? detectPreviewFileKind({
        filePath: selectedFilePath,
        mimeType: selectedFileMimeType,
      })
    : "text";
  const selectedFileError =
    selectedFileQuery.error instanceof Error
      ? selectedFileQuery.error.message
      : selectedFileQuery.error
        ? "Failed to load file preview."
        : null;
  const refetchSelectedFile = selectedFileQuery.refetch;

  useEffect(() => {
    if (!selectedFilePath || previewSearch.preview !== "1") {
      previousSelectedFileRefreshKeyRef.current = latestSelectedFileRefreshKey;
      return;
    }
    if (previousSelectedFileRefreshKeyRef.current === null) {
      previousSelectedFileRefreshKeyRef.current = latestSelectedFileRefreshKey;
      return;
    }
    if (previousSelectedFileRefreshKeyRef.current === latestSelectedFileRefreshKey) {
      return;
    }
    previousSelectedFileRefreshKeyRef.current = latestSelectedFileRefreshKey;
    void refetchSelectedFile();
  }, [latestSelectedFileRefreshKey, previewSearch.preview, refetchSelectedFile, selectedFilePath]);

  useEffect(() => {
    if (!selectedFilePath || !isMissingWorkspaceFileError(selectedFileError)) {
      missingFileRefreshKeyRef.current = null;
      return;
    }
    const refreshKey = `${activeCwd ?? ""}\u0000${selectedFilePath}\u0000${selectedFileError}`;
    if (missingFileRefreshKeyRef.current === refreshKey) {
      return;
    }
    missingFileRefreshKeyRef.current = refreshKey;
    void refetchProjectFiles()
      .then((result) => {
        if (!result.data?.entries.some((entry) => entry.path === selectedFilePath)) {
          setSelectedFilePath((current) => (current === selectedFilePath ? null : current));
        }
      })
      .catch(() => undefined);
  }, [activeCwd, refetchProjectFiles, selectedFileError, selectedFilePath]);

  const previewTextFile = useMemo(() => {
    const contents = richSelectedFileData?.contents;
    if (!selectedFilePath || selectedFileKind !== "text" || contents === undefined) {
      return null;
    }

    return {
      name: selectedFilePath,
      contents,
      lang: inferPreviewLanguage(selectedFilePath),
      cacheKey: buildPreviewFileCacheKey(selectedFilePath, contents),
    };
  }, [richSelectedFileData?.contents, selectedFileKind, selectedFilePath]);

  const onResizePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>) => {
      if (event.button !== 0) return;
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startWidth: treeWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      document.body.style.cursor = "e-resize";
      document.body.style.userSelect = "none";
    },
    [treeWidth],
  );

  const onResizePointerMove = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    const container = splitLayoutRef.current;
    if (!resizeState || !container || resizeState.pointerId !== event.pointerId) {
      return;
    }
    event.preventDefault();
    const nextWidth = getResizedTreeWidth(resizeState, container.clientWidth, event.clientX);
    setTreeWidth(nextWidth);
  }, []);

  const onResizePointerEnd = useCallback((event: ReactPointerEvent<HTMLButtonElement>) => {
    const resizeState = resizeStateRef.current;
    const container = splitLayoutRef.current;
    if (!resizeState || !container || resizeState.pointerId !== event.pointerId) {
      return;
    }
    const nextWidth = getResizedTreeWidth(resizeState, container.clientWidth, event.clientX);
    resizeStateRef.current = null;
    setTreeWidth(nextWidth);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    document.body.style.removeProperty("cursor");
    document.body.style.removeProperty("user-select");
    if (typeof window !== "undefined") {
      setLocalStorageItem(PREVIEW_TREE_WIDTH_STORAGE_KEY, nextWidth, Schema.Finite);
    }
  }, []);

  useEffect(
    () => () => {
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    },
    [],
  );

  const onRefreshProjectFiles = useCallback(() => {
    void refetchProjectFiles();
  }, [refetchProjectFiles]);

  const headerRow = (
    <>
      <div className="min-w-0 flex-1 px-1 [-webkit-app-region:no-drag]">
        <div className="truncate text-sm font-medium text-foreground">File Preview</div>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Workspace tree</span>
          {projectFilesTruncated ? (
            <Badge variant="warning" size="sm" className="rounded-md px-1.5 py-0 text-[9px]">
              Truncated
            </Badge>
          ) : null}
        </div>
      </div>
      <div className="flex shrink-0 items-center gap-1 [-webkit-app-region:no-drag]">
        <Button
          aria-label="Refresh workspace tree"
          title="Refresh workspace tree"
          variant="outline"
          size="icon-xs"
          className="shrink-0"
          disabled={!activeThread?.environmentId || !activeCwd || projectFilesIsFetching}
          onClick={onRefreshProjectFiles}
        >
          <RefreshCwIcon className={cn("size-3", projectFilesIsFetching && "animate-spin")} />
        </Button>
        <Toggle
          aria-label={
            wrapPreviewLines ? "Disable preview line wrapping" : "Enable preview line wrapping"
          }
          title={wrapPreviewLines ? "Disable line wrapping" : "Enable line wrapping"}
          variant="outline"
          size="xs"
          pressed={wrapPreviewLines}
          onPressedChange={(pressed) => {
            setWrapPreviewLines(Boolean(pressed));
          }}
        >
          <TextWrapIcon className="size-3" />
        </Toggle>
      </div>
    </>
  );

  return (
    <DiffPanelShell mode={mode} header={headerRow}>
      {!activeThread ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          Select a thread to preview files.
        </div>
      ) : projectFilesQuery.isLoading && !projectFilesQuery.data ? (
        <DiffPanelLoadingState label="Loading project tree..." />
      ) : projectFilesError && !projectFilesQuery.data ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          {projectFilesError}
        </div>
      ) : (projectFilesQuery.data?.entries.length ?? 0) === 0 ? (
        <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
          No project files available yet.
        </div>
      ) : (
        <div ref={splitLayoutRef} className="flex min-h-0 min-w-0 flex-1">
          <div
            className="min-h-0 shrink-0 overflow-auto bg-card/20 p-2"
            style={{ width: `${treeWidth}px`, maxWidth: "55%" } satisfies CSSProperties}
          >
            {projectFilesError || projectFilesTruncated ? (
              <Alert
                variant={projectFilesError ? "error" : "warning"}
                className="mb-2 rounded-lg border-border/70 px-3 py-2 text-[11px]"
              >
                {projectFilesError ? (
                  <CircleAlertIcon className="size-3.5" />
                ) : (
                  <TriangleAlertIcon className="size-3.5" />
                )}
                <AlertTitle className="text-[11px]">
                  {projectFilesError
                    ? "Workspace tree refresh failed"
                    : "Workspace tree is truncated"}
                </AlertTitle>
                <AlertDescription className="gap-1 text-[11px] leading-4">
                  {projectFilesError ? (
                    <span>{projectFilesError}</span>
                  ) : (
                    <span>
                      Only the first indexed workspace entries are shown here, so some files may be
                      omitted from preview.
                    </span>
                  )}
                </AlertDescription>
              </Alert>
            ) : null}
            <ChangedFilesTree
              files={projectFilesQuery.data?.entries ?? []}
              allDirectoriesExpanded={false}
              resolvedTheme={resolvedTheme}
              onSelectFile={setSelectedFilePath}
              selectedFilePath={selectedFilePath}
              showStats={false}
            />
          </div>
          <button
            type="button"
            aria-label="Resize file preview tree"
            className="group relative w-2 shrink-0 cursor-e-resize bg-background transition-colors hover:bg-accent/40"
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerEnd}
            onPointerCancel={onResizePointerEnd}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 group-hover:bg-border" />
          </button>
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            {!selectedFilePath ? (
              <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
                Select a file to preview.
              </div>
            ) : selectedFileSizeGuard?.state === "too-large" ? (
              <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
                File is too large to preview ({selectedFileSizeGuard.sizeBytes} bytes). Limit is{" "}
                {selectedFileSizeGuard.limitBytes} bytes.
              </div>
            ) : selectedFileQuery.isLoading && !selectedFileData ? (
              <DiffPanelLoadingState label="Loading file preview..." />
            ) : selectedFileError ? (
              <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
                {selectedFileError}
              </div>
            ) : (
              <div className="min-h-0 flex-1 overflow-auto p-2">
                <style>{PREVIEW_CODE_CSS}</style>
                <div className="min-h-full overflow-hidden rounded-md border border-border/70 bg-[color:color-mix(in_srgb,var(--card)_90%,var(--background))]">
                  <div className="border-b border-border/70 bg-[color:color-mix(in_srgb,var(--card)_94%,var(--foreground))] px-3 py-2 text-foreground">
                    <div className="truncate font-mono text-[12px] font-medium">
                      {selectedFilePath}
                    </div>
                  </div>
                  {selectedFileKind === "image" && richSelectedFileData?.base64 ? (
                    <div className="flex min-h-0 justify-center overflow-auto bg-background/70 p-3">
                      <img
                        alt={selectedFilePath}
                        className="max-h-full max-w-full object-contain"
                        src={`data:${selectedFileMimeType ?? "image/png"};base64,${
                          richSelectedFileData.base64
                        }`}
                      />
                    </div>
                  ) : previewTextFile ? (
                    <DiffsFile
                      file={previewTextFile}
                      className="preview-panel-diffs-file"
                      options={{
                        disableFileHeader: true,
                        overflow: wrapPreviewLines ? "wrap" : "scroll",
                        theme: resolveDiffThemeName(resolvedTheme),
                        themeType: resolvedTheme,
                        unsafeCSS: PREVIEW_FILE_UNSAFE_CSS,
                        tokenizeMaxLineLength: 1_000,
                      }}
                    />
                  ) : (
                    <pre
                      className={cn(
                        "min-h-full bg-transparent p-3 font-mono text-[11px] leading-5 text-muted-foreground/90",
                        wrapPreviewLines
                          ? "overflow-auto whitespace-pre-wrap wrap-break-word"
                          : "overflow-auto",
                      )}
                    >
                      {richSelectedFileData?.contents ?? ""}
                    </pre>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </DiffPanelShell>
  );
}
