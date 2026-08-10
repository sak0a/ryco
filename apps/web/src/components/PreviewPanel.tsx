import { File as DiffsFile } from "@pierre/diffs/react";
import { useBlocker, useParams, useSearch } from "@tanstack/react-router";
import { Schema } from "effect";
import {
  ArrowLeftIcon,
  CircleAlertIcon,
  FolderOpenIcon,
  LoaderCircleIcon,
  PanelRightCloseIcon,
  PanelRightOpenIcon,
  RefreshCwIcon,
  SaveIcon,
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
import { setProjectReadFileCacheData } from "~/rpc/projectPreviewAtoms";
import { ensureEnvironmentApi } from "~/environmentApi";
import { selectProjectByRef, useStore } from "../store";
import { createThreadSelectorByRef } from "../storeSelectors";
import { resolveThreadRouteRef } from "../threadRoutes";
import { DraftId, useComposerDraftStore } from "../composerDraftStore";
import type { TurnDiffSummary } from "../types";
import { ChangedFilesTree } from "./chat/ChangedFilesTree";
import { DiffPanelLoadingState, DiffPanelShell, type DiffPanelMode } from "./DiffPanelShell";
import { PreviewFileEditor } from "./PreviewFileEditor";
import { PREVIEW_FILE_UNSAFE_CSS } from "./PreviewFileStyles";
import {
  beginPreviewFileSave,
  createPreviewFileDocument,
  createPreviewFileEditSession,
  discardPreviewFileChanges,
  failPreviewFileSave,
  finishPreviewFileSave,
  isPreviewFileSessionDirty,
  readPreviewFileSaveFailure,
  reconcilePreviewFileSession,
  updatePreviewFileSessionContents,
  type PreviewFileEditSession,
} from "./PreviewFileEditSession";
import { Badge } from "./ui/badge";
import { Alert, AlertDescription, AlertTitle } from "./ui/alert";
import { Button } from "./ui/button";
import { Toggle } from "./ui/toggle";
import {
  AlertDialog,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogPopup,
  AlertDialogTitle,
} from "./ui/alert-dialog";
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
  padding: 0.75rem;
  background-color: color-mix(in srgb, var(--card) 90%, var(--background));
}

.preview-panel-file-card {
  container-type: inline-size;
}

@container (max-width: 360px) {
  .preview-panel-file-toolbar {
    flex-wrap: wrap;
    gap: 0.25rem;
    padding-block: 0.375rem;
  }

  .preview-panel-file-identity {
    flex-basis: 100%;
  }

  .preview-panel-file-actions {
    margin-left: auto;
  }
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
  readonly version?: string;
  readonly encoding?: "utf8" | "utf8-bom";
  readonly lineEnding?: "lf" | "crlf" | "cr" | "mixed";
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
  // Phone work surface: the two-pane tree+preview split becomes a single-pane
  // push — the tree renders full-width and selecting a file pushes a
  // full-width file view with a back-to-tree affordance. Tree data, filter,
  // and file loading logic are shared with the desktop presentations.
  const isPhonePresentation = mode === "phone";
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
  const [editSession, setEditSession] = useState<PreviewFileEditSession | null>(null);
  const editSessionRef = useRef<PreviewFileEditSession | null>(null);
  const [pendingFilePath, setPendingFilePath] = useState<string | null>(null);
  const [fileFilterQuery, setFileFilterQuery] = useState("");
  const [isTreeVisible, setIsTreeVisible] = useState(true);
  // Same readability rationale as the phone diff surface: 320-430px columns
  // are unreadable with horizontal code scroll, so wrap defaults on for the
  // phone presentation only; desktop keeps the settings-driven default.
  const [wrapPreviewLines, setWrapPreviewLines] = useState(
    isPhonePresentation ? true : settings.diffWordWrap,
  );
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

  const commitEditSession = useCallback((next: PreviewFileEditSession | null) => {
    editSessionRef.current = next;
    setEditSession(next);
  }, []);

  useEffect(() => {
    setWrapPreviewLines(isPhonePresentation ? true : settings.diffWordWrap);
  }, [isPhonePresentation, settings.diffWordWrap]);

  useEffect(() => {
    setSelectedFilePath(null);
    commitEditSession(null);
    setPendingFilePath(null);
    setIsTreeVisible(true);
  }, [activeThread?.environmentId, activeThread?.id, commitEditSession]);

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
      if (!isPreviewFileSessionDirty(editSessionRef.current)) {
        setSelectedFilePath(null);
        commitEditSession(null);
      }
      return;
    }
    if (selectedFilePath && !projectFiles.entries.some((file) => file.path === selectedFilePath)) {
      if (!isPreviewFileSessionDirty(editSessionRef.current)) {
        setSelectedFilePath(null);
        commitEditSession(null);
      }
    }
  }, [commitEditSession, projectFiles, selectedFilePath]);

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
          const currentSession = editSessionRef.current;
          if (
            currentSession?.relativePath === selectedFilePath &&
            isPreviewFileSessionDirty(currentSession)
          ) {
            commitEditSession(
              failPreviewFileSave(currentSession, {
                reason: "deleted",
                message:
                  "This file was removed from disk after it was opened. Explorer will not recreate it.",
              }),
            );
          } else {
            setSelectedFilePath((current) => (current === selectedFilePath ? null : current));
            if (currentSession?.relativePath === selectedFilePath) commitEditSession(null);
          }
        }
      })
      .catch(() => undefined);
  }, [activeCwd, commitEditSession, refetchProjectFiles, selectedFileError, selectedFilePath]);

  const selectedFileDocument = useMemo(() => {
    if (
      !activeThread?.environmentId ||
      !activeCwd ||
      !selectedFileData ||
      selectedFileData.relativePath !== selectedFilePath
    ) {
      return null;
    }
    return createPreviewFileDocument(
      { environmentId: activeThread.environmentId, cwd: activeCwd },
      selectedFileData,
    );
  }, [activeCwd, activeThread?.environmentId, selectedFileData, selectedFilePath]);

  useEffect(() => {
    if (!selectedFileDocument) return;
    commitEditSession(reconcilePreviewFileSession(editSessionRef.current, selectedFileDocument));
  }, [commitEditSession, selectedFileDocument]);

  const currentEditSession =
    selectedFileDocument && editSession?.key === selectedFileDocument.key ? editSession : null;
  const hasUnsavedChanges = isPreviewFileSessionDirty(currentEditSession);
  const isSelectedFileEditable = Boolean(
    !isPhonePresentation &&
    selectedFileKind === "text" &&
    selectedFileDocument &&
    selectedFileDocument.lineEnding !== "mixed",
  );
  const shouldBlockNavigation = useCallback(() => hasUnsavedChanges, [hasUnsavedChanges]);
  const navigationBlocker = useBlocker({
    shouldBlockFn: shouldBlockNavigation,
    disabled: !hasUnsavedChanges,
    enableBeforeUnload: hasUnsavedChanges,
    withResolver: true,
  });

  const openFileImmediately = useCallback(
    (filePath: string) => {
      commitEditSession(null);
      setSelectedFilePath(filePath);
    },
    [commitEditSession],
  );

  const onSelectFile = useCallback(
    (filePath: string) => {
      if (filePath === selectedFilePath) return;
      if (isPreviewFileSessionDirty(editSessionRef.current)) {
        setPendingFilePath(filePath);
        return;
      }
      openFileImmediately(filePath);
    },
    [openFileImmediately, selectedFilePath],
  );

  const onEditContentsChange = useCallback(
    (contents: string) => {
      const current = editSessionRef.current;
      if (!current || current.key !== selectedFileDocument?.key) return;
      commitEditSession(updatePreviewFileSessionContents(current, contents));
    },
    [commitEditSession, selectedFileDocument?.key],
  );

  const reloadSelectedFile = useCallback(async () => {
    if (!activeThread?.environmentId || !activeCwd || !selectedFilePath) return false;
    try {
      const data = await ensureEnvironmentApi(activeThread.environmentId).projects.readFile({
        cwd: activeCwd,
        relativePath: selectedFilePath,
      });
      setProjectReadFileCacheData(
        {
          environmentId: activeThread.environmentId,
          cwd: activeCwd,
          relativePath: selectedFilePath,
        },
        data,
      );
      commitEditSession(
        createPreviewFileEditSession(
          createPreviewFileDocument(
            { environmentId: activeThread.environmentId, cwd: activeCwd },
            data,
          ),
        ),
      );
      return true;
    } catch (error) {
      const current = editSessionRef.current;
      if (current) {
        commitEditSession(
          failPreviewFileSave(current, {
            reason: isMissingWorkspaceFileError(
              error instanceof Error ? error.message : String(error),
            )
              ? "deleted"
              : "failed",
            message: error instanceof Error ? error.message : "Failed to reload this file.",
          }),
        );
      }
      return false;
    }
  }, [activeCwd, activeThread?.environmentId, commitEditSession, selectedFilePath]);

  const onDiscardFileChanges = useCallback(() => {
    const current = editSessionRef.current;
    if (!current || current.key !== selectedFileDocument?.key) return;
    if (current.errorReason === "deleted") {
      commitEditSession(null);
      setSelectedFilePath(null);
      void refetchProjectFiles();
      return;
    }
    if (current.saveStatus === "conflict") {
      void reloadSelectedFile();
      return;
    }
    commitEditSession(discardPreviewFileChanges(current));
  }, [commitEditSession, refetchProjectFiles, reloadSelectedFile, selectedFileDocument?.key]);

  const saveSelectedFile = useCallback(async () => {
    const current = editSessionRef.current;
    if (
      !current ||
      !activeThread?.environmentId ||
      !activeCwd ||
      current.relativePath !== selectedFilePath ||
      current.lineEnding === "mixed" ||
      current.saveStatus === "saving" ||
      current.saveStatus === "conflict" ||
      !isPreviewFileSessionDirty(current)
    ) {
      return false;
    }

    const savingKey = current.key;
    const savedContents = current.contents;
    commitEditSession(beginPreviewFileSave(current));
    try {
      const result = await ensureEnvironmentApi(activeThread.environmentId).projects.writeFile({
        cwd: activeCwd,
        relativePath: current.relativePath,
        contents: savedContents,
        expectedVersion: current.version,
        encoding: current.encoding,
        lineEnding: current.lineEnding,
      });
      setProjectReadFileCacheData(
        {
          environmentId: activeThread.environmentId,
          cwd: activeCwd,
          relativePath: current.relativePath,
        },
        {
          relativePath: current.relativePath,
          contents: savedContents,
          version: result.version,
          encoding: current.encoding,
          lineEnding: current.lineEnding,
        },
      );
      const latest = editSessionRef.current;
      if (!latest || latest.key !== savingKey) return false;
      const saved = finishPreviewFileSave(latest, savedContents, result.version);
      commitEditSession(saved);
      return !isPreviewFileSessionDirty(saved);
    } catch (error) {
      const latest = editSessionRef.current;
      if (latest?.key === savingKey) {
        commitEditSession(failPreviewFileSave(latest, readPreviewFileSaveFailure(error)));
      }
      return false;
    }
  }, [activeCwd, activeThread?.environmentId, commitEditSession, selectedFilePath]);

  const saveIsBlocked =
    currentEditSession?.saveStatus === "conflict" ||
    currentEditSession?.errorReason === "unsupported";
  const canSaveSelectedFile = Boolean(
    isSelectedFileEditable &&
    hasUnsavedChanges &&
    currentEditSession?.saveStatus !== "saving" &&
    !saveIsBlocked,
  );

  useEffect(() => {
    if (!isSelectedFileEditable || !hasUnsavedChanges) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        if (canSaveSelectedFile) void saveSelectedFile();
      }
    };
    window.addEventListener("keydown", onKeyDown, { capture: true });
    return () => window.removeEventListener("keydown", onKeyDown, { capture: true });
  }, [canSaveSelectedFile, hasUnsavedChanges, isSelectedFileEditable, saveSelectedFile]);

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
  const previewFileOptions = useMemo(
    () => ({
      disableFileHeader: true,
      overflow: wrapPreviewLines ? ("wrap" as const) : ("scroll" as const),
      theme: resolveDiffThemeName(resolvedTheme),
      themeType: resolvedTheme,
      unsafeCSS: PREVIEW_FILE_UNSAFE_CSS,
      tokenizeMaxLineLength: 1_000,
    }),
    [resolvedTheme, wrapPreviewLines],
  );

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

  const unsavedDialogOpen = pendingFilePath !== null || navigationBlocker.status === "blocked";

  const cancelUnsavedNavigation = useCallback(() => {
    setPendingFilePath(null);
    if (navigationBlocker.status === "blocked") navigationBlocker.reset();
  }, [navigationBlocker]);

  const continueUnsavedNavigation = useCallback(() => {
    const nextFilePath = pendingFilePath;
    setPendingFilePath(null);
    commitEditSession(null);
    if (nextFilePath) {
      setSelectedFilePath(nextFilePath);
      return;
    }
    if (navigationBlocker.status === "blocked") navigationBlocker.proceed();
  }, [commitEditSession, navigationBlocker, pendingFilePath]);

  const saveAndContinueNavigation = useCallback(async () => {
    if (!(await saveSelectedFile())) return;
    continueUnsavedNavigation();
  }, [continueUnsavedNavigation, saveSelectedFile]);

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
        {/* Single-pane phone push has no side-by-side tree to hide. */}
        {isPhonePresentation ? null : (
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
        )}
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

  const selectedFileView =
    selectedFileSizeGuard?.state === "too-large" ? (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        File is too large to preview ({selectedFileSizeGuard.sizeBytes} bytes). Limit is{" "}
        {selectedFileSizeGuard.limitBytes} bytes.
      </div>
    ) : selectedFileQuery.isLoading && !selectedFileData ? (
      <DiffPanelLoadingState label="Loading file preview..." />
    ) : selectedFileError && !selectedFileData ? (
      <div className="flex flex-1 items-center justify-center px-5 text-center text-xs text-muted-foreground/70">
        {selectedFileError}
      </div>
    ) : (
      <div className="min-h-0 flex-1 p-2">
        <style>{PREVIEW_CODE_CSS}</style>
        <div className="preview-panel-file-card flex h-full min-h-0 flex-col overflow-hidden rounded-md border border-border/70 bg-[color:color-mix(in_srgb,var(--card)_90%,var(--background))]">
          <div className="preview-panel-file-toolbar flex min-h-10 shrink-0 items-center gap-3 border-b border-border/70 bg-[color:color-mix(in_srgb,var(--card)_94%,var(--foreground))] px-3 py-1.5 text-foreground">
            <div className="preview-panel-file-identity flex min-w-0 flex-1 items-center gap-2">
              <div className="truncate font-mono text-[12px] font-medium">{selectedFilePath}</div>
              {hasUnsavedChanges ? (
                <span
                  aria-label="Unsaved changes"
                  className="size-1.5 shrink-0 rounded-full bg-primary"
                  title="Unsaved changes"
                />
              ) : null}
              {currentEditSession?.saveStatus === "saving" ? (
                <span
                  aria-live="polite"
                  className="flex shrink-0 items-center gap-1 text-[10px] text-muted-foreground"
                >
                  <LoaderCircleIcon className="size-3 animate-spin" /> Saving
                </span>
              ) : null}
              {!isPhonePresentation && selectedFileDocument?.lineEnding === "mixed" ? (
                <span className="shrink-0 text-[10px] text-muted-foreground">
                  Read-only · mixed line endings
                </span>
              ) : null}
            </div>
            {isSelectedFileEditable && currentEditSession ? (
              <div className="preview-panel-file-actions flex shrink-0 items-center gap-1">
                <Button
                  aria-label="Discard file changes"
                  disabled={!hasUnsavedChanges || currentEditSession.saveStatus === "saving"}
                  onClick={onDiscardFileChanges}
                  size="xs"
                  variant="ghost"
                >
                  Discard
                </Button>
                <Button
                  aria-label="Save file"
                  disabled={!canSaveSelectedFile}
                  onClick={() => void saveSelectedFile()}
                  size="xs"
                  title="Save file (Ctrl/⌘ S)"
                >
                  {currentEditSession.saveStatus === "saving" ? (
                    <LoaderCircleIcon className="animate-spin" />
                  ) : (
                    <SaveIcon />
                  )}
                  Save
                  <span className="ml-0.5 text-[9px] opacity-70">⌘S</span>
                </Button>
              </div>
            ) : null}
          </div>
          {currentEditSession?.errorMessage ? (
            <div className="shrink-0 border-b border-border/60 p-2">
              <Alert
                variant={currentEditSession.saveStatus === "conflict" ? "warning" : "error"}
                className="rounded-lg px-3 py-2 text-[11px]"
              >
                {currentEditSession.saveStatus === "conflict" ? (
                  <TriangleAlertIcon className="size-3.5" />
                ) : (
                  <CircleAlertIcon className="size-3.5" />
                )}
                <AlertTitle className="text-[11px]">
                  {currentEditSession.errorReason === "deleted"
                    ? "File removed on disk"
                    : currentEditSession.saveStatus === "conflict"
                      ? "File changed on disk"
                      : "Couldn’t save file"}
                </AlertTitle>
                <AlertDescription className="gap-2 text-[11px] leading-4">
                  <span>{currentEditSession.errorMessage}</span>
                  {currentEditSession.saveStatus === "conflict" ? (
                    <Button
                      className="self-start"
                      onClick={
                        currentEditSession.errorReason === "deleted"
                          ? onDiscardFileChanges
                          : () => void reloadSelectedFile()
                      }
                      size="xs"
                      variant="outline"
                    >
                      {currentEditSession.errorReason === "deleted" ? "Close file" : "Reload"}
                    </Button>
                  ) : null}
                </AlertDescription>
              </Alert>
            </div>
          ) : selectedFileError ? (
            <div className="shrink-0 border-b border-border/60 px-3 py-2 text-[11px] text-destructive">
              Refresh failed: {selectedFileError}
            </div>
          ) : null}
          {selectedFileKind === "image" && richSelectedFileData?.base64 ? (
            <div className="flex min-h-0 flex-1 justify-center overflow-auto bg-background/70 p-3">
              <img
                alt={selectedFilePath ?? undefined}
                className="max-h-full max-w-full object-contain"
                src={`data:${selectedFileMimeType ?? "image/png"};base64,${
                  richSelectedFileData.base64
                }`}
              />
            </div>
          ) : isSelectedFileEditable && currentEditSession ? (
            <PreviewFileEditor
              cacheKey={currentEditSession.key}
              className="preview-panel-diffs-file"
              contents={currentEditSession.contents}
              filePath={currentEditSession.relativePath}
              language={inferPreviewLanguage(currentEditSession.relativePath)}
              onChange={onEditContentsChange}
              options={previewFileOptions}
            />
          ) : previewTextFile ? (
            <div className="min-h-0 flex-1 overflow-auto">
              <DiffsFile
                file={previewTextFile}
                className="preview-panel-diffs-file"
                options={previewFileOptions}
              />
            </div>
          ) : (
            <pre
              className={cn(
                "min-h-0 flex-1 bg-transparent p-3 font-mono text-[11px] leading-5 text-muted-foreground/90",
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
    );

  const treePane = (
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
              {projectFilesError ? "Workspace tree refresh failed" : "Workspace tree is truncated"}
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
        {filteredProjectFiles.length === 0 ? (
          <div className="px-2 py-6 text-center text-xs leading-5 text-muted-foreground/70">
            No files match this filter.
          </div>
        ) : (
          <ChangedFilesTree
            files={filteredProjectFiles}
            allDirectoriesExpanded={isFilteringProjectFiles}
            resolvedTheme={resolvedTheme}
            onSelectFile={onSelectFile}
            selectedFilePath={selectedFilePath}
            showStats={false}
          />
        )}
      </div>
    </div>
  );

  return (
    <>
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
        ) : isPhonePresentation ? (
          // Single-pane phone arrangement: tree full-width, tapping a file
          // pushes a full-width file view with back-to-tree. A `preview=1` deep
          // link lands on the tree (the preview params carry no file path), so
          // the surface is never empty.
          <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-hidden">
            {selectedFilePath ? (
              <div className="flex min-h-0 min-w-0 flex-1 flex-col">
                <div className="flex min-h-12 shrink-0 items-center gap-1 border-b border-border/60 px-1.5">
                  <Button
                    size="icon"
                    variant="ghost"
                    aria-label="Back to workspace tree"
                    className="shrink-0"
                    onClick={() => setSelectedFilePath(null)}
                  >
                    <ArrowLeftIcon />
                  </Button>
                  <span className="min-w-0 flex-1 truncate font-mono text-xs text-foreground">
                    {selectedFilePath}
                  </span>
                </div>
                {selectedFileView}
              </div>
            ) : (
              treePane
            )}
          </div>
        ) : (
          <div ref={splitLayoutRef} className="flex min-h-0 min-w-0 flex-1 overflow-hidden">
            <div
              data-preview-content-panel
              className="flex min-h-0 min-w-0 flex-1 flex-col transition-[min-width] duration-[320ms] ease-[cubic-bezier(0.16,1,0.3,1)] motion-reduce:transition-none"
            >
              {!selectedFilePath ? <PreviewOpenFileEmptyState /> : selectedFileView}
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
            <PreviewTreeMotionFrame
              width={treeWidth}
              open={isTreeVisible}
              resizing={isTreeResizing}
            >
              {treePane}
            </PreviewTreeMotionFrame>
          </div>
        )}
      </DiffPanelShell>
      <AlertDialog
        open={unsavedDialogOpen}
        onOpenChange={(open) => {
          if (!open) cancelUnsavedNavigation();
        }}
      >
        <AlertDialogPopup>
          <AlertDialogHeader>
            <AlertDialogTitle>Save changes before continuing?</AlertDialogTitle>
            <AlertDialogDescription>
              {selectedFilePath
                ? `${selectedFilePath} has unsaved changes.`
                : "This file has unsaved changes."}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <Button onClick={cancelUnsavedNavigation} variant="outline">
              Cancel
            </Button>
            <Button
              disabled={currentEditSession?.saveStatus === "saving"}
              onClick={continueUnsavedNavigation}
              variant="destructive-outline"
            >
              {pendingFilePath ? "Discard & Open" : "Discard & Continue"}
            </Button>
            <Button
              disabled={!canSaveSelectedFile}
              onClick={() => void saveAndContinueNavigation()}
            >
              {currentEditSession?.saveStatus === "saving" ? (
                <LoaderCircleIcon className="animate-spin" />
              ) : (
                <SaveIcon />
              )}
              {pendingFilePath ? "Save & Open" : "Save & Continue"}
            </Button>
          </AlertDialogFooter>
        </AlertDialogPopup>
      </AlertDialog>
    </>
  );
}
