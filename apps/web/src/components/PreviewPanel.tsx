import { File as DiffsFile } from "@pierre/diffs/react";
import { useParams, useSearch } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  CircleAlertIcon,
  FolderOpenIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  SearchIcon,
  TextWrapIcon,
  TriangleAlertIcon,
} from "lucide-react";
import {
  type PointerEvent as ReactPointerEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import { parsePreviewRouteSearch } from "../previewRouteSearch";
import { fnv1a32, resolveDiffThemeName } from "../lib/diffRendering";
import { useSettings } from "../hooks/useSettings";
import { useTheme } from "../hooks/useTheme";
import { getLocalStorageItem, setLocalStorageItem } from "../hooks/useLocalStorage";
import { useProjectListEntries, useProjectReadFile } from "~/rpc/useProjectPreview";
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
  filterPreviewProjectEntries,
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
  const delta = resizeState.startX - pointerClientX;
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

function PreviewTreeMotionFrame(props: {
  children: ReactNode;
  open: boolean;
  resizing: boolean;
  width: number;
}) {
  const [entered, setEntered] = useState(props.open);

  useEffect(() => {
    if (!props.open) {
      setEntered(false);
      return;
    }
    const frameId = window.requestAnimationFrame(() => setEntered(true));
    return () => window.cancelAnimationFrame(frameId);
  }, [props.open]);

  const active = props.open && entered;

  return (
    <div
      data-preview-file-rail
      aria-hidden={props.open ? undefined : true}
      inert={props.open ? undefined : true}
      className={cn(
        "min-h-0 shrink-0 overflow-hidden bg-card/20",
        props.open ? "border-l border-border/70" : "border-l-0",
        props.resizing
          ? "transition-none"
          : "transition-[width,opacity] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none",
        props.open ? "opacity-100" : "opacity-0",
      )}
      style={{
        width: props.open ? `${props.width}px` : "0px",
        maxWidth: "55%",
      }}
    >
      <div
        className={cn(
          "h-full min-h-0 transition-[translate,opacity] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] will-change-transform motion-reduce:transition-none",
          props.resizing ? "transition-none" : null,
          active ? "translate-x-0 opacity-100" : "translate-x-4 opacity-0",
        )}
        style={{ width: `${props.width}px`, maxWidth: "100%" }}
      >
        {props.children}
      </div>
    </div>
  );
}

function PreviewOpenFileEmptyState() {
  return (
    <div className="flex flex-1 items-center justify-center px-5 text-center">
      <div className="flex max-w-xs flex-col items-center gap-3">
        <FolderOpenIcon className="size-8 text-muted-foreground/65" />
        <div className="space-y-1.5">
          <div className="text-sm font-semibold text-foreground">Open file</div>
          <div className="text-xs leading-5 text-muted-foreground/70">
            Select a file from the workspace tree.
          </div>
        </div>
      </div>
    </div>
  );
}

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
  const [fileFilterQuery, setFileFilterQuery] = useState("");
  const [isTreeVisible, setIsTreeVisible] = useState(true);
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
  const [isTreeResizing, setIsTreeResizing] = useState(false);
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
    setIsTreeVisible(true);
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

  const projectFilesQuery = useProjectListEntries({
    environmentId: activeThread?.environmentId ?? null,
    cwd: activeCwd,
    enabled: Boolean(activeThread?.environmentId && activeCwd && previewSearch.preview === "1"),
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
  const filteredProjectFiles = useMemo(
    () => filterPreviewProjectEntries(projectFiles?.entries ?? [], fileFilterQuery),
    [fileFilterQuery, projectFiles?.entries],
  );
  const isFilteringProjectFiles = fileFilterQuery.trim().length > 0;

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

  const selectedFileQuery = useProjectReadFile({
    environmentId: activeThread?.environmentId ?? null,
    cwd: activeCwd,
    relativePath: selectedFilePath,
    enabled: Boolean(
      activeThread?.environmentId &&
      activeCwd &&
      selectedFilePath &&
      previewSearch.preview === "1" &&
      (selectedFileSizeGuard?.shouldFetch ?? true),
    ),
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
      if (event.button !== 0 || !isTreeVisible) return;
      const renderedTreeWidth =
        splitLayoutRef.current
          ?.querySelector<HTMLElement>("[data-preview-file-rail]")
          ?.getBoundingClientRect().width ?? treeWidth;
      resizeStateRef.current = {
        pointerId: event.pointerId,
        startWidth: renderedTreeWidth,
        startX: event.clientX,
      };
      event.currentTarget.setPointerCapture(event.pointerId);
      setIsTreeResizing(true);
      document.body.style.cursor = "ew-resize";
      document.body.style.userSelect = "none";
    },
    [isTreeVisible, treeWidth],
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
    if (!resizeState || resizeState.pointerId !== event.pointerId) {
      return;
    }
    const container = splitLayoutRef.current;
    const nextWidth = container
      ? getResizedTreeWidth(resizeState, container.clientWidth, event.clientX)
      : resizeState.startWidth;
    resizeStateRef.current = null;
    setIsTreeResizing(false);
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

  const onToggleTreeVisibility = useCallback(() => {
    if (isTreeVisible) {
      resizeStateRef.current = null;
      setIsTreeResizing(false);
      document.body.style.removeProperty("cursor");
      document.body.style.removeProperty("user-select");
    }
    setIsTreeVisible((current) => !current);
  }, [isTreeVisible]);

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
          aria-label={isTreeVisible ? "Hide workspace tree" : "Show workspace tree"}
          aria-pressed={isTreeVisible}
          title={isTreeVisible ? "Hide workspace tree" : "Show workspace tree"}
          variant="outline"
          size="icon-xs"
          className="shrink-0"
          onClick={onToggleTreeVisibility}
        >
          {isTreeVisible ? (
            <PanelRightCloseIcon className="size-3" />
          ) : (
            <PanelRightOpenIcon className="size-3" />
          )}
        </Button>
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
        <div ref={splitLayoutRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
          <div
            data-preview-content-panel
            className="flex min-h-0 min-w-0 flex-1 flex-col transition-[min-width] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
          >
            {!selectedFilePath ? (
              <PreviewOpenFileEmptyState />
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
          <button
            type="button"
            aria-label="Resize workspace tree"
            aria-hidden={isTreeVisible ? undefined : true}
            className={cn(
              "group relative shrink-0 overflow-hidden bg-background transition-[width,opacity,background-color] duration-[360ms] ease-[cubic-bezier(0.16,1,0.3,1)] hover:bg-accent/40 motion-reduce:transition-none",
              isTreeVisible ? "w-2 cursor-ew-resize opacity-100" : "w-0 opacity-0",
            )}
            disabled={!isTreeVisible}
            onPointerDown={onResizePointerDown}
            onPointerMove={onResizePointerMove}
            onPointerUp={onResizePointerEnd}
            onPointerCancel={onResizePointerEnd}
          >
            <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-border/80 group-hover:bg-border" />
          </button>
          <PreviewTreeMotionFrame width={treeWidth} open={isTreeVisible} resizing={isTreeResizing}>
            <div className="flex h-full min-h-0 flex-col">
              <div className="shrink-0 border-b border-border/60 p-2">
                <label className="relative block">
                  <SearchIcon className="pointer-events-none absolute left-2.5 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground/65" />
                  <input
                    type="text"
                    value={fileFilterQuery}
                    onChange={(event) => setFileFilterQuery(event.target.value)}
                    onKeyDown={(event) => {
                      if (event.key === "Escape") {
                        setFileFilterQuery("");
                        event.currentTarget.blur();
                      }
                    }}
                    placeholder="Filter files..."
                    aria-label="Filter files"
                    className="h-8 w-full rounded-md border border-border/70 bg-background/65 pl-8 pr-3 text-xs text-foreground outline-none transition-[border-color,background-color,box-shadow] placeholder:text-muted-foreground/55 focus:border-ring/60 focus:bg-background focus:shadow-[0_0_0_3px_color-mix(in_srgb,var(--ring)_18%,transparent)]"
                  />
                </label>
              </div>
              <div className="min-h-0 flex-1 overflow-auto p-2">
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
                          Only the first indexed workspace entries are shown here, so some files may
                          be omitted from preview.
                        </span>
                      )}
                    </AlertDescription>
                  </Alert>
                ) : null}
                {filteredProjectFiles.length === 0 ? (
                  <div className="px-2 py-6 text-center text-xs leading-5 text-muted-foreground/70">
                    No files match this filter.
                  </div>
                ) : (
                  <ChangedFilesTree
                    files={filteredProjectFiles}
                    allDirectoriesExpanded={isFilteringProjectFiles}
                    resolvedTheme={resolvedTheme}
                    onSelectFile={setSelectedFilePath}
                    selectedFilePath={selectedFilePath}
                    showStats={false}
                  />
                )}
              </div>
            </div>
          </PreviewTreeMotionFrame>
        </div>
      )}
    </DiffPanelShell>
  );
}
