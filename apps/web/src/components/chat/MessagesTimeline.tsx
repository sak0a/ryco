import {
  type EnvironmentId,
  type MessageId,
  type ServerProviderSkill,
  type TurnId,
} from "@ryco/contracts";
import {
  createContext,
  memo,
  use,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent,
  type ReactNode,
} from "react";
import { LegendList, type LegendListRef } from "@legendapp/list/react";
import { deriveTimelineEntries, formatElapsed } from "../../session-logic";
import { type TurnDiffSummary } from "../../types";
import { summarizeTurnDiffStats } from "../../lib/turnDiffTree";
import ChatMarkdown from "../ChatMarkdown";
import {
  BotIcon,
  CheckIcon,
  ChevronDownIcon,
  ChevronRightIcon,
  CircleAlertIcon,
  EyeIcon,
  GlobeIcon,
  HammerIcon,
  type LucideIcon,
  SquarePenIcon,
  TerminalIcon,
  Undo2Icon,
  WrenchIcon,
  ZapIcon,
} from "lucide-react";
import { Button } from "../ui/button";
import { buildExpandedImagePreview, ExpandedImagePreview } from "./ExpandedImagePreview";
import { ProposedPlanCard } from "./ProposedPlanCard";
import { ChangedFilesTree } from "./ChangedFilesTree";
import { DiffStatLabel, hasNonZeroStat } from "./DiffStatLabel";
import { MessageCopyButton } from "./MessageCopyButton";
import {
  buildTimelineStableState,
  buildTimelineStreamingState,
  computeStableMessagesTimelineRows,
  deriveTimelineMinimapItems,
  isErroredWorkEntry,
  deriveMessagesTimelineRows,
  normalizeCompactToolLabel,
  resolveAssistantMessageCopyState,
  resolveTimelineMinimapHasPersistentGutter,
  resolveTimelineMinimapHeightStyle,
  resolveTimelineMinimapHitStripWidth,
  resolveTimelineMinimapIndexFromPointer,
  resolveTimelineMinimapInteractiveWidth,
  resolveTimelineMinimapTopPercent,
  type StableMessagesTimelineRowsState,
  type MessagesTimelineRow,
  type TimelineMinimapItem,
  type TimelineMessageActionsRequest,
  type TimelineStableState,
  type TimelineStreamingState,
  type TimelineLatestTurn,
  TIMELINE_MINIMAP_MIN_ITEMS,
} from "./MessagesTimeline.logic";
import { MessageActionsSheet } from "./MessageActionsSheet";
import { useLongPress } from "~/hooks/useLongPress";
import { usePresentationTier } from "~/hooks/usePresentationTier";
import type { ThreadMessageSearchOccurrence } from "./ThreadMessageSearch.logic";
import { TerminalContextInlineChip } from "./TerminalContextInlineChip";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";
import {
  deriveDisplayedUserMessageState,
  type ParsedTerminalContextEntry,
} from "~/lib/terminalContext";
import { cn } from "~/lib/utils";
import { useUiStateStore } from "~/uiStateStore";
import { type TimestampFormat } from "@ryco/contracts/settings";
import { formatTimestamp } from "../../timestampFormat";
import { usePerfMark } from "../../perf/tabSwitchInstrumentation";
import { visibleSecondTicker } from "../../lib/perf/ticker";

import {
  buildInlineTerminalContextText,
  formatInlineTerminalContextLabel,
  textContainsInlineTerminalContextLabels,
} from "./userMessageTerminalContexts";
import { SkillInlineText, type SkillInlineTextSearchHighlight } from "./SkillInlineText";
import { formatWorkspaceRelativePath } from "../../filePathDisplay";

// ---------------------------------------------------------------------------
// Context — shared state consumed by row components via useContext. Split into
// two contexts so streaming transitions (activeTurnInProgress / isWorking / …)
// do not invalidate the stable context value (theme/cwd/skills/timestampFormat/
// callbacks). Rows that only read stable state skip re-rendering during
// streaming. Propagates through LegendList's memo boundaries. `nowIso` is
// intentionally excluded — self-ticking components (WorkingTimer, LiveElapsed)
// handle it.
// ---------------------------------------------------------------------------

const TimelineStreamingCtx = createContext<TimelineStreamingState>(null!);
const TimelineStableCtx = createContext<TimelineStableState>(null!);
const NOOP_CLOSE_DIFF = () => {};
const TIMELINE_LIST_HEADER = <div className="h-3 sm:h-4" />;
const TIMELINE_LIST_FOOTER = <div className="h-3 sm:h-4" />;
const EMPTY_TIMELINE_SKILLS: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">> = [];
const EMPTY_THREAD_MESSAGE_SEARCH_OCCURRENCES_BY_MESSAGE_ID: ReadonlyMap<
  MessageId,
  ReadonlyArray<ThreadMessageSearchOccurrence>
> = new Map();
const EMPTY_EXPANSION_OVERRIDES: Readonly<Record<string, boolean>> = {};
const MESSAGE_SEARCH_HIGHLIGHT_DURATION_MS = 1_800;
const MESSAGE_ACTION_BUTTON_CLASS_NAME =
  "size-6 min-w-6 rounded-md border-0 bg-transparent px-0 text-muted-foreground/45 shadow-none transition-[background-color,color,box-shadow] before:hidden hover:bg-foreground/8 hover:text-foreground/75 hover:shadow-sm/5 focus-visible:ring-1 focus-visible:ring-ring/60 disabled:hover:bg-transparent disabled:hover:text-muted-foreground/35";

// ---------------------------------------------------------------------------
// Props (public API)
// ---------------------------------------------------------------------------

interface MessagesTimelineProps {
  isWorking: boolean;
  activeTurnInProgress: boolean;
  activeTurnId?: TurnId | null;
  latestTurn?: TimelineLatestTurn | null;
  activeTurnStartedAt: string | null;
  listRef: React.RefObject<LegendListRef | null>;
  targetMessageId?: MessageId | null;
  targetMessageRequestId?: number;
  targetMessageRowHighlight?: boolean;
  threadMessageSearchQuery?: string;
  threadMessageSearchOccurrencesByMessageId?: ReadonlyMap<
    MessageId,
    ReadonlyArray<ThreadMessageSearchOccurrence>
  >;
  activeThreadMessageSearchOccurrence?: ThreadMessageSearchOccurrence | null;
  timelineEntries: ReturnType<typeof deriveTimelineEntries>;
  turnDiffSummaryByAssistantMessageId: Map<MessageId, TurnDiffSummary>;
  openDiffTurnId?: TurnId | null;
  routeThreadKey: string;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onCloseDiff?: () => void;
  revertTurnCountByUserMessageId: Map<MessageId, number>;
  onRevertUserMessage: (messageId: MessageId) => void;
  isRevertingCheckpoint: boolean;
  onImageExpand: (preview: ExpandedImagePreview) => void;
  activeThreadEnvironmentId: EnvironmentId;
  markdownCwd: string | undefined;
  resolvedTheme: "light" | "dark";
  timestampFormat: TimestampFormat;
  workspaceRoot: string | undefined;
  skills?: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  onIsAtEndChange: (isAtEnd: boolean) => void;
}

// ---------------------------------------------------------------------------
// MessagesTimeline — list owner
// ---------------------------------------------------------------------------

export const MessagesTimeline = memo(function MessagesTimeline({
  isWorking,
  activeTurnInProgress,
  activeTurnId,
  latestTurn = null,
  activeTurnStartedAt,
  listRef,
  targetMessageId = null,
  targetMessageRequestId = 0,
  targetMessageRowHighlight = true,
  threadMessageSearchQuery = "",
  threadMessageSearchOccurrencesByMessageId = EMPTY_THREAD_MESSAGE_SEARCH_OCCURRENCES_BY_MESSAGE_ID,
  activeThreadMessageSearchOccurrence = null,
  timelineEntries,
  turnDiffSummaryByAssistantMessageId,
  openDiffTurnId = null,
  routeThreadKey,
  onOpenTurnDiff,
  onCloseDiff,
  revertTurnCountByUserMessageId,
  onRevertUserMessage,
  isRevertingCheckpoint,
  onImageExpand,
  activeThreadEnvironmentId,
  markdownCwd,
  resolvedTheme,
  timestampFormat,
  workspaceRoot,
  skills = EMPTY_TIMELINE_SKILLS,
  onIsAtEndChange,
}: MessagesTimelineProps) {
  usePerfMark("MessagesTimeline");
  const turnFoldExpandedById = useUiStateStore(
    (store) => store.threadTurnFoldExpandedById[routeThreadKey] ?? EMPTY_EXPANSION_OVERRIDES,
  );
  const workGroupExpandedById = useUiStateStore(
    (store) => store.threadWorkGroupExpandedById[routeThreadKey] ?? EMPTY_EXPANSION_OVERRIDES,
  );
  const revertTurnCountRef = useRef(revertTurnCountByUserMessageId);
  revertTurnCountRef.current = revertTurnCountByUserMessageId;
  const rawRows = useMemo(
    () =>
      deriveMessagesTimelineRows({
        timelineEntries,
        latestTurn,
        runningTurnId: isWorking || activeTurnInProgress ? (activeTurnId ?? null) : null,
        turnFoldExpandedById,
        workGroupExpandedById,
        isWorking,
        activeTurnStartedAt,
        turnDiffSummaryByAssistantMessageId,
        revertTurnCountByUserMessageId: revertTurnCountRef.current,
      }),
    [
      timelineEntries,
      latestTurn,
      activeTurnInProgress,
      activeTurnId,
      turnFoldExpandedById,
      workGroupExpandedById,
      isWorking,
      activeTurnStartedAt,
      turnDiffSummaryByAssistantMessageId,
    ],
  );
  const rows = useStableRows(rawRows);
  const minimapItems = useMemo(() => deriveTimelineMinimapItems(rows), [rows]);
  const [minimapStripMap] = useState(() => new Map<string, HTMLSpanElement>());
  const [timelineViewportElement, setTimelineViewportElement] = useState<HTMLDivElement | null>(
    null,
  );
  const [minimapHasPersistentGutter, setMinimapHasPersistentGutter] = useState(false);
  const [minimapHitStripWidth, setMinimapHitStripWidth] = useState(0);
  const [highlightedMessageId, setHighlightedMessageId] = useState<MessageId | null>(null);
  // Long-press target for the phone message action sheet.
  const [messageActionsRequest, setMessageActionsRequest] =
    useState<TimelineMessageActionsRequest | null>(null);
  const onOpenMessageActions = useCallback((request: TimelineMessageActionsRequest) => {
    setMessageActionsRequest(request);
  }, []);

  const handleScroll = useCallback(() => {
    const state = listRef.current?.getState?.();
    if (state) {
      onIsAtEndChange(state.isAtEnd);
    }
    if (!state || minimapItems.length === 0) {
      return;
    }

    const scrollTop = state.scroll ?? 0;
    const scrollBottom = scrollTop + (state.scrollLength ?? 0);

    for (const item of minimapItems) {
      const strip = minimapStripMap.get(item.id);
      if (!strip) {
        continue;
      }

      const rowTop = resolveTimelineRowTop(state, item.rowIndex);
      const rowHeight = resolveTimelineRowHeight(state, item.rowIndex);
      const inView =
        rowTop !== null &&
        rowTop < scrollBottom &&
        rowTop + Math.max(1, rowHeight ?? 1) > scrollTop;

      strip.dataset.inView = inView ? "true" : "false";
    }
  }, [listRef, minimapItems, minimapStripMap, onIsAtEndChange]);

  useEffect(() => {
    const frame = requestAnimationFrame(handleScroll);
    return () => cancelAnimationFrame(frame);
  }, [handleScroll, rows.length]);

  useEffect(() => {
    if (!timelineViewportElement) {
      return;
    }

    const measure = () => {
      const viewportWidth = timelineViewportElement.getBoundingClientRect().width;
      const nextHasPersistentGutter = resolveTimelineMinimapHasPersistentGutter(viewportWidth);
      setMinimapHasPersistentGutter((current) =>
        current === nextHasPersistentGutter ? current : nextHasPersistentGutter,
      );
      setMinimapHitStripWidth(resolveTimelineMinimapHitStripWidth(viewportWidth));
    };

    const frame = requestAnimationFrame(measure);
    const observer = new ResizeObserver(measure);
    observer.observe(timelineViewportElement);

    return () => {
      cancelAnimationFrame(frame);
      observer.disconnect();
    };
  }, [timelineViewportElement]);

  const previousRowCountRef = useRef(rows.length);
  useEffect(() => {
    const previousRowCount = previousRowCountRef.current;
    previousRowCountRef.current = rows.length;

    if (previousRowCount > 0 || rows.length === 0) {
      return;
    }

    onIsAtEndChange(true);
    const frameId = window.requestAnimationFrame(() => {
      void listRef.current?.scrollToEnd?.({ animated: false });
    });
    return () => {
      window.cancelAnimationFrame(frameId);
    };
  }, [listRef, onIsAtEndChange, rows.length]);

  useEffect(() => {
    if (targetMessageId === null) {
      setHighlightedMessageId(null);
      return;
    }

    const targetRowIndex = rows.findIndex(
      (row) => row.kind === "message" && row.message.id === targetMessageId,
    );
    if (targetRowIndex < 0) {
      setHighlightedMessageId(null);
      return;
    }

    setHighlightedMessageId(targetMessageRowHighlight ? targetMessageId : null);
    void listRef.current?.scrollToIndex?.({
      animated: true,
      index: targetRowIndex,
      viewPosition: 0.45,
    });

    const frameId = window.requestAnimationFrame(() => {
      if (!targetMessageRowHighlight) {
        const activeSearchHit = document.querySelector<HTMLElement>(
          '[data-thread-message-search-active="true"]',
        );
        if (activeSearchHit) {
          activeSearchHit.scrollIntoView({ behavior: "smooth", block: "center" });
          return;
        }
      }
      for (const element of document.querySelectorAll<HTMLElement>("[data-message-id]")) {
        if (element.dataset.messageId === targetMessageId) {
          element.scrollIntoView({ behavior: "smooth", block: "center" });
          break;
        }
      }
    });
    const timeoutId = window.setTimeout(() => {
      setHighlightedMessageId((current) => (current === targetMessageId ? null : current));
    }, MESSAGE_SEARCH_HIGHLIGHT_DURATION_MS);

    return () => {
      window.cancelAnimationFrame(frameId);
      window.clearTimeout(timeoutId);
    };
  }, [listRef, rows, targetMessageId, targetMessageRequestId, targetMessageRowHighlight]);

  // Streaming-frequent context — rebuilt on turn-lifecycle transitions.
  const streamingState = useMemo<TimelineStreamingState>(
    () =>
      buildTimelineStreamingState({
        activeTurnInProgress,
        activeTurnId: activeTurnId ?? null,
        isWorking,
        isRevertingCheckpoint,
        openDiffTurnId,
      }),
    [activeTurnInProgress, activeTurnId, isWorking, isRevertingCheckpoint, openDiffTurnId],
  );

  // Stable context — identity preserved across streaming transitions so rows
  // that only read stable state do not re-render. Callbacks from ChatView are
  // useCallback-stable.
  const stableState = useMemo<TimelineStableState>(
    () =>
      buildTimelineStableState({
        timestampFormat,
        routeThreadKey,
        markdownCwd,
        resolvedTheme,
        workspaceRoot,
        skills,
        activeThreadEnvironmentId,
        highlightedMessageId,
        threadMessageSearchQuery,
        threadMessageSearchOccurrencesByMessageId,
        activeThreadMessageSearchOccurrence,
        onRevertUserMessage,
        onImageExpand,
        onOpenTurnDiff,
        onCloseDiff: onCloseDiff ?? NOOP_CLOSE_DIFF,
        onOpenMessageActions,
      }),
    [
      timestampFormat,
      routeThreadKey,
      markdownCwd,
      resolvedTheme,
      workspaceRoot,
      skills,
      activeThreadEnvironmentId,
      highlightedMessageId,
      threadMessageSearchQuery,
      threadMessageSearchOccurrencesByMessageId,
      activeThreadMessageSearchOccurrence,
      onRevertUserMessage,
      onImageExpand,
      onOpenTurnDiff,
      onCloseDiff,
      onOpenMessageActions,
    ],
  );

  // Stable renderItem — no closure deps. Row components read shared state
  // from the split timeline contexts, which propagate through LegendList's memo.
  const renderItem = useCallback(
    ({ item }: { item: MessagesTimelineRow }) => (
      <div className="mx-auto w-full min-w-0 max-w-3xl overflow-x-hidden" data-timeline-root="true">
        <TimelineRowContent row={item} />
      </div>
    ),
    [],
  );

  if (rows.length === 0 && !isWorking) {
    return (
      <div className="flex h-full items-center justify-center">
        <p className="text-sm text-muted-foreground/30">
          Send a message to start the conversation.
        </p>
      </div>
    );
  }

  return (
    <TimelineStableCtx.Provider value={stableState}>
      <TimelineStreamingCtx.Provider value={streamingState}>
        <div ref={setTimelineViewportElement} className="relative h-full min-h-0">
          <LegendList<MessagesTimelineRow>
            ref={listRef}
            data={rows}
            keyExtractor={keyExtractor}
            renderItem={renderItem}
            estimatedItemSize={90}
            initialScrollAtEnd
            maintainScrollAtEnd
            maintainScrollAtEndThreshold={0.1}
            maintainVisibleContentPosition
            onScroll={handleScroll}
            className="h-full overflow-x-hidden overscroll-y-contain px-3 [scrollbar-gutter:stable] sm:px-5"
            ListHeaderComponent={TIMELINE_LIST_HEADER}
            ListFooterComponent={TIMELINE_LIST_FOOTER}
          />
          <TimelineMinimap
            hasPersistentGutter={minimapHasPersistentGutter}
            hitStripWidth={minimapHitStripWidth}
            items={minimapItems}
            stripMap={minimapStripMap}
            onSelect={(item) => {
              void listRef.current?.scrollToIndex({
                index: item.rowIndex,
                animated: true,
                viewOffset: 24,
              });
            }}
          />
        </div>
        <MessageActionsSheet
          target={messageActionsRequest}
          onOpenChange={(open) => {
            if (!open) setMessageActionsRequest(null);
          }}
          revertDisabled={isRevertingCheckpoint || isWorking}
          onRevert={() => {
            if (messageActionsRequest) {
              onRevertUserMessage(messageActionsRequest.messageId);
            }
          }}
        />
      </TimelineStreamingCtx.Provider>
    </TimelineStableCtx.Provider>
  );
});

function keyExtractor(item: MessagesTimelineRow) {
  return item.id;
}

interface TimelinePositionState {
  readonly scroll?: number;
  readonly scrollLength?: number;
  readonly positionAtIndex?: (index: number) => number | undefined;
  readonly sizeAtIndex?: (index: number) => number | undefined;
}

function resolveTimelineRowTop(state: TimelinePositionState, rowIndex: number): number | null {
  const top = state.positionAtIndex?.(rowIndex);
  return typeof top === "number" && Number.isFinite(top) ? top : null;
}

function resolveTimelineRowHeight(state: TimelinePositionState, rowIndex: number): number | null {
  const height = state.sizeAtIndex?.(rowIndex);
  return typeof height === "number" && Number.isFinite(height) ? height : null;
}

function timelineMinimapEventTargetsPreview(target: EventTarget): boolean {
  return target instanceof Element && target.closest("[data-minimap-preview]") !== null;
}

function TimelineMinimap({
  hasPersistentGutter,
  hitStripWidth,
  items,
  stripMap,
  onSelect,
}: {
  hasPersistentGutter: boolean;
  hitStripWidth: number;
  items: ReadonlyArray<TimelineMinimapItem>;
  stripMap: Map<string, HTMLSpanElement>;
  onSelect: (item: TimelineMinimapItem) => void;
}) {
  const [activeIndex, setActiveIndex] = useState<number | null>(null);

  const resolvedActiveIndex =
    activeIndex !== null && activeIndex < items.length ? activeIndex : null;
  const activeItem = resolvedActiveIndex === null ? null : (items[resolvedActiveIndex] ?? null);
  const activeTopPercent =
    resolvedActiveIndex === null
      ? 0
      : resolveTimelineMinimapTopPercent(resolvedActiveIndex, items.length);
  const activeTooltipTranslate =
    resolvedActiveIndex === null
      ? "-50%"
      : resolvedActiveIndex === 0
        ? "0%"
        : resolvedActiveIndex === items.length - 1
          ? "-100%"
          : "-50%";

  const resolveActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      const rect = event.currentTarget.getBoundingClientRect();
      return resolveTimelineMinimapIndexFromPointer({
        itemCount: items.length,
        railTop: rect.top,
        railHeight: rect.height,
        pointerY: event.clientY,
      });
    },
    [items.length],
  );

  const updateActiveIndexFromPointer = useCallback(
    (event: MouseEvent<HTMLElement>) => {
      setActiveIndex(resolveActiveIndexFromPointer(event));
    },
    [resolveActiveIndexFromPointer],
  );

  const moveActiveIndex = useCallback(
    (delta: number) => {
      setActiveIndex((current) => {
        const base = current ?? 0;
        return Math.max(0, Math.min(items.length - 1, base + delta));
      });
    },
    [items.length],
  );

  if (items.length < TIMELINE_MINIMAP_MIN_ITEMS) {
    return null;
  }

  return (
    <div
      className={cn(
        "group/minimap pointer-events-none absolute inset-y-0 left-0 z-40 hidden w-18 [@media(pointer:fine)]:block",
        hasPersistentGutter
          ? "opacity-100"
          : "opacity-0 transition-opacity duration-150 hover:opacity-100 focus-within:opacity-100",
      )}
      data-persistent-gutter={hasPersistentGutter ? "true" : "false"}
      data-testid="timeline-minimap"
    >
      <div className="relative h-full w-full select-none">
        <button
          aria-label={`Jump to message: ${activeItem?.userText ?? "User message"}`}
          className={cn(
            "absolute top-1/2 left-3 -translate-y-1/2 cursor-pointer bg-transparent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/70",
            hitStripWidth > 0 ? "pointer-events-auto" : "pointer-events-none",
          )}
          data-testid="timeline-minimap-hit-strip"
          onBlur={() => setActiveIndex(null)}
          onClick={(event) => {
            if (timelineMinimapEventTargetsPreview(event.target)) {
              return;
            }
            const nextIndex = resolveActiveIndexFromPointer(event);
            const nextItem = nextIndex === null ? null : (items[nextIndex] ?? null);
            if (nextItem) {
              onSelect(nextItem);
            }
            event.currentTarget.blur();
          }}
          onFocus={() => setActiveIndex((current) => current ?? 0)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown") {
              event.preventDefault();
              moveActiveIndex(1);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              moveActiveIndex(-1);
            } else if (event.key === "Home") {
              event.preventDefault();
              setActiveIndex(0);
            } else if (event.key === "End") {
              event.preventDefault();
              setActiveIndex(items.length - 1);
            } else if (event.key === "Enter" || event.key === " ") {
              event.preventDefault();
              if (activeItem) {
                onSelect(activeItem);
              }
            }
          }}
          onMouseDown={(event) => {
            if (!timelineMinimapEventTargetsPreview(event.target)) {
              event.preventDefault();
            }
          }}
          onMouseLeave={() => setActiveIndex(null)}
          onMouseMove={updateActiveIndexFromPointer}
          style={{
            height: resolveTimelineMinimapHeightStyle(items.length),
            width: resolveTimelineMinimapInteractiveWidth(hitStripWidth, activeItem !== null),
          }}
          type="button"
        >
          <span aria-hidden="true" className="absolute top-0 left-3 h-full w-px bg-border/15" />
          {items.map((item, index) => {
            const activeDistance =
              resolvedActiveIndex === null ? null : Math.abs(index - resolvedActiveIndex);

            return (
              <span
                aria-hidden="true"
                className={cn(
                  "pointer-events-none absolute left-0 h-0.5 -translate-y-1/2 rounded-full bg-muted-foreground/35 transition-[background-color,width] duration-150 data-[in-view=true]:bg-foreground/90",
                  activeDistance === 0
                    ? "w-6 bg-muted-foreground/75"
                    : activeDistance === 1
                      ? "w-4"
                      : activeDistance === 2
                        ? "w-2.5"
                        : "w-2",
                )}
                data-in-view="false"
                data-minimap-message-id={item.id}
                data-minimap-strip
                key={item.id}
                ref={(node) => {
                  if (node) {
                    stripMap.set(item.id, node);
                  } else {
                    stripMap.delete(item.id);
                  }
                }}
                style={{
                  top: `${resolveTimelineMinimapTopPercent(index, items.length)}%`,
                }}
              />
            );
          })}
          {activeItem ? (
            <span
              className="pointer-events-auto absolute left-8 w-80 cursor-text select-text"
              data-minimap-preview
              onMouseMove={(event) => event.stopPropagation()}
              style={{
                top: `${activeTopPercent}%`,
                transform: `translateY(${activeTooltipTranslate})`,
              }}
            >
              <span className="block rounded-xl border border-border/70 bg-popover/95 p-3 text-left text-popover-foreground shadow-xl shadow-black/25 backdrop-blur">
                <span className="block max-w-full overflow-hidden text-ellipsis whitespace-nowrap text-sm font-medium leading-5">
                  {activeItem.userText ?? "User message"}
                </span>
                {activeItem.assistantText ? (
                  <span
                    className="mt-1 max-h-[3.75rem] overflow-hidden text-muted-foreground text-sm leading-5"
                    style={{
                      display: "-webkit-box",
                      WebkitBoxOrient: "vertical",
                      WebkitLineClamp: 3,
                    }}
                  >
                    {activeItem.assistantText}
                  </span>
                ) : null}
              </span>
            </span>
          ) : null}
        </button>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// TimelineRowContent — the actual row component
// ---------------------------------------------------------------------------

type TimelineEntry = ReturnType<typeof deriveTimelineEntries>[number];
type TimelineMessage = Extract<TimelineEntry, { kind: "message" }>["message"];
type TimelineWorkEntry = Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"][number];
type TimelineRow = MessagesTimelineRow;

function TimelineRowContent({ row }: { row: TimelineRow }) {
  // This row renderer reads both contexts (it depends on streaming + stable
  // fields), so it re-renders on streaming transitions as before. The merged
  // object is local — it does not propagate through any context boundary.
  const ctx = { ...use(TimelineStableCtx), ...use(TimelineStreamingCtx) };
  // Phone tier: long-press on a message bubble opens the message action
  // sheet with the same copy/revert actions as the desktop hover row.
  const isPhoneTier = usePresentationTier() === "phone";
  const messageLongPress = useLongPress(
    () => {
      if (row.kind !== "message") return;
      if (row.message.role === "user") {
        const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
        const copyText = displayedUserMessage.copyText ?? null;
        const canRevert = typeof row.revertTurnCount === "number";
        // No actions apply (nothing to copy, no checkpoint): open no sheet.
        if (copyText === null && !canRevert) return;
        ctx.onOpenMessageActions({
          messageId: row.message.id,
          role: "user",
          copyText,
          canRevert,
        });
        return;
      }
      if (row.message.role !== "assistant") return;
      const assistantCopyState = resolveAssistantRowCopyState(row, ctx);
      const copyText = assistantCopyState.visible ? (assistantCopyState.text ?? null) : null;
      // A streaming or copy-ineligible response has no actions: open no sheet.
      if (copyText === null) return;
      ctx.onOpenMessageActions({
        messageId: row.message.id,
        role: "assistant",
        copyText,
        canRevert: false,
      });
    },
    { disabled: !isPhoneTier || row.kind !== "message" },
  );
  const isHighlightedMessage =
    row.kind === "message" && ctx.highlightedMessageId === row.message.id;
  const messageSearchOccurrences =
    row.kind === "message"
      ? ctx.threadMessageSearchOccurrencesByMessageId.get(row.message.id)
      : undefined;
  const messageSearchHighlight =
    row.kind === "message" &&
    messageSearchOccurrences !== undefined &&
    messageSearchOccurrences.length > 0 &&
    ctx.threadMessageSearchQuery.trim().length > 0
      ? {
          query: ctx.threadMessageSearchQuery,
          activeOccurrenceIndex:
            ctx.activeThreadMessageSearchOccurrence?.messageId === row.message.id
              ? ctx.activeThreadMessageSearchOccurrence.messageOccurrenceIndex
              : null,
        }
      : undefined;

  return (
    <div
      className={cn(
        row.kind === "work"
          ? "pb-0.5"
          : row.kind === "work-toggle" ||
              (row.kind === "message" &&
                row.message.role === "assistant" &&
                !row.showAssistantCopyButton)
            ? "pb-2"
            : "pb-4",
        row.kind === "message"
          ? "scroll-mt-12 rounded-xl transition-[background-color,box-shadow] duration-500"
          : null,
        isHighlightedMessage ? "bg-primary/10 ring-1 ring-primary/30" : null,
        row.kind === "message" && row.message.role === "assistant" ? "group/assistant" : null,
      )}
      data-timeline-row-id={row.id}
      data-timeline-row-kind={row.kind}
      data-message-id={row.kind === "message" ? row.message.id : undefined}
      data-message-highlighted={isHighlightedMessage ? "true" : undefined}
      data-message-role={row.kind === "message" ? row.message.role : undefined}
    >
      {row.kind === "work" && <WorkGroupSection groupedEntries={row.groupedEntries} />}
      {row.kind === "work-toggle" && <WorkGroupToggleTimelineRow row={row} />}
      {row.kind === "turn-fold" && <TurnFoldTimelineRow row={row} />}

      {row.kind === "context-compaction" && (
        <ContextCompactionMarkerRow createdAt={row.createdAt} label={row.marker.label} />
      )}

      {row.kind === "message" &&
        row.message.role === "user" &&
        (() => {
          const userImages = row.message.attachments ?? [];
          const displayedUserMessage = deriveDisplayedUserMessageState(row.message.text);
          const terminalContexts = displayedUserMessage.contexts;
          const canRevertAgentWork = typeof row.revertTurnCount === "number";
          return (
            <div className="flex justify-end">
              <div className="group flex max-w-[80%] flex-col items-end">
                <div
                  className="relative rounded-2xl rounded-br-sm bg-foreground/8 px-3 py-2 shadow-md/5 transition-[background-color,box-shadow] duration-200 group-hover:bg-foreground/10 group-hover:shadow-lg/8"
                  {...messageLongPress}
                >
                  {userImages.length > 0 && (
                    <div className="mb-2 grid max-w-[420px] grid-cols-2 gap-2">
                      {userImages.map(
                        (image: NonNullable<TimelineMessage["attachments"]>[number]) => (
                          <div
                            key={image.id}
                            className="overflow-hidden rounded-lg border border-border/80 bg-background/70"
                          >
                            {image.previewUrl ? (
                              <button
                                type="button"
                                className="h-full w-full cursor-zoom-in"
                                aria-label={`Preview ${image.name}`}
                                onClick={() => {
                                  const preview = buildExpandedImagePreview(userImages, image.id);
                                  if (!preview) return;
                                  ctx.onImageExpand(preview);
                                }}
                              >
                                <img
                                  src={image.previewUrl}
                                  alt={image.name}
                                  className="block h-auto max-h-[220px] w-full object-cover"
                                />
                              </button>
                            ) : (
                              <div className="flex min-h-[72px] items-center justify-center px-2 py-3 text-center text-[11px] text-muted-foreground/70">
                                <span>
                                  {image.name}
                                  <span className="mt-1 block">
                                    Preview unavailable on this connection.
                                  </span>
                                </span>
                              </div>
                            )}
                          </div>
                        ),
                      )}
                    </div>
                  )}
                  {(displayedUserMessage.visibleText.trim().length > 0 ||
                    terminalContexts.length > 0) && (
                    <UserMessageBody
                      text={displayedUserMessage.visibleText}
                      terminalContexts={terminalContexts}
                      skills={ctx.skills}
                      searchHighlight={messageSearchHighlight}
                    />
                  )}
                </div>
                <div className="mt-1 flex items-center justify-end gap-2">
                  <div className="flex items-center gap-1.5 opacity-0 transition-opacity duration-200 focus-within:opacity-100 group-hover:opacity-100 phone:opacity-100">
                    {displayedUserMessage.copyText && (
                      <MessageCopyButton
                        text={displayedUserMessage.copyText}
                        size="icon-xs"
                        variant="ghost"
                        className={MESSAGE_ACTION_BUTTON_CLASS_NAME}
                        ariaLabel="Copy message"
                      />
                    )}
                    {canRevertAgentWork && (
                      <Button
                        type="button"
                        size="icon-xs"
                        variant="ghost"
                        className={MESSAGE_ACTION_BUTTON_CLASS_NAME}
                        disabled={ctx.isRevertingCheckpoint || ctx.isWorking}
                        onClick={() => ctx.onRevertUserMessage(row.message.id)}
                        title="Revert to this message"
                      >
                        <Undo2Icon className="size-3" />
                      </Button>
                    )}
                  </div>
                  <p className="text-right text-[11px] text-muted-foreground/50">
                    {formatTimestamp(row.message.createdAt, ctx.timestampFormat)}
                  </p>
                </div>
              </div>
            </div>
          );
        })()}

      {row.kind === "message" &&
        row.message.role === "assistant" &&
        (() => {
          const messageText = row.message.text || (row.message.streaming ? "" : "(empty response)");
          const assistantResponseStillInProgress = resolveAssistantRowInProgress(row, ctx);
          const assistantCopyState = resolveAssistantRowCopyState(row, ctx);
          return (
            <>
              <div className="min-w-0 px-1 py-0.5" {...messageLongPress}>
                <ChatMarkdown
                  text={messageText}
                  cwd={ctx.markdownCwd}
                  isStreaming={assistantResponseStillInProgress}
                  skills={ctx.skills}
                  searchHighlight={messageSearchHighlight}
                />
                {!assistantResponseStillInProgress && (
                  <AssistantChangedFilesSection
                    turnSummary={row.assistantTurnDiffSummary}
                    routeThreadKey={ctx.routeThreadKey}
                    resolvedTheme={ctx.resolvedTheme}
                    openDiffTurnId={ctx.openDiffTurnId}
                    onOpenTurnDiff={ctx.onOpenTurnDiff}
                    onCloseDiff={ctx.onCloseDiff}
                  />
                )}
                <div className="mt-1.5 flex items-center gap-2">
                  <p className="text-[10px] text-muted-foreground/30">
                    {row.message.streaming ? (
                      <LiveMessageMeta
                        createdAt={row.message.createdAt}
                        durationStart={row.durationStart}
                        timestampFormat={ctx.timestampFormat}
                      />
                    ) : (
                      formatMessageMeta(
                        row.message.createdAt,
                        formatElapsed(row.durationStart, row.message.completedAt),
                        ctx.timestampFormat,
                      )
                    )}
                  </p>
                  {assistantCopyState.visible ? (
                    <div className="flex items-center opacity-0 transition-opacity duration-200 group-hover/assistant:opacity-100 phone:opacity-100">
                      <MessageCopyButton
                        text={assistantCopyState.text ?? ""}
                        size="icon-xs"
                        variant="ghost"
                        className={MESSAGE_ACTION_BUTTON_CLASS_NAME}
                        ariaLabel="Copy response"
                      />
                    </div>
                  ) : null}
                </div>
              </div>
            </>
          );
        })()}

      {row.kind === "proposed-plan" && (
        <div className="min-w-0 px-1 py-0.5">
          <ProposedPlanCard
            planMarkdown={row.proposedPlan.planMarkdown}
            environmentId={ctx.activeThreadEnvironmentId}
            cwd={ctx.markdownCwd}
            workspaceRoot={ctx.workspaceRoot}
          />
        </div>
      )}

      {row.kind === "working" && <PendingWorkingTimelineRow row={row} />}
    </div>
  );
}

function TurnFoldTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "turn-fold" }> }) {
  const { routeThreadKey } = use(TimelineStableCtx);
  const setExpanded = useUiStateStore((store) => store.setThreadTurnFoldExpanded);
  const Icon = row.expanded ? ChevronDownIcon : ChevronRightIcon;

  return (
    <div className="border-b border-border/60 pt-1 pb-2" data-turn-fold-status={row.status}>
      <button
        type="button"
        aria-expanded={row.expanded}
        onClick={() => setExpanded(routeThreadKey, row.foldId, !row.expanded)}
        className="flex cursor-pointer select-none items-center gap-1 rounded-md px-1 text-xs text-muted-foreground tabular-nums transition-colors duration-150 hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70"
      >
        <span>
          {row.status === "running" ? (
            row.durationStart ? (
              <>
                Working for <WorkingTimer createdAt={row.durationStart} />
              </>
            ) : (
              "Working…"
            )
          ) : (
            (row.label ?? "Worked")
          )}
        </span>
        <Icon className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}

function PendingWorkingTimelineRow({ row }: { row: Extract<TimelineRow, { kind: "working" }> }) {
  return (
    <div className="border-b border-border/60 pt-1 pb-2">
      <div className="flex items-center px-1 text-xs text-muted-foreground tabular-nums">
        {row.createdAt ? (
          <>
            Working for <WorkingTimer createdAt={row.createdAt} />
          </>
        ) : (
          "Working…"
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Self-ticking labels update their own text nodes so elapsed-time display does
// not create a React commit every second while a response is streaming.
// ---------------------------------------------------------------------------

/** Live "Working for Xs" label. */
function WorkingTimer({ createdAt }: { createdAt: string }) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatWorkingTimerNow(createdAt);

  useEffect(() => {
    const updateText = (nowMs: number) => {
      if (textRef.current) {
        textRef.current.textContent = formatWorkingTimerNow(createdAt, nowMs);
      }
    };
    return visibleSecondTicker.subscribe(updateText);
  }, [createdAt]);

  return <span ref={textRef}>{initialText}</span>;
}

/** Live timestamp + elapsed duration for a streaming assistant message. */
function LiveMessageMeta({
  createdAt,
  durationStart,
  timestampFormat,
}: {
  createdAt: string;
  durationStart: string | null | undefined;
  timestampFormat: TimestampFormat;
}) {
  const textRef = useRef<HTMLSpanElement>(null);
  const initialText = formatLiveMessageMetaNow(createdAt, durationStart, timestampFormat);

  useEffect(() => {
    const updateText = (nowMs: number) => {
      if (textRef.current) {
        textRef.current.textContent = formatLiveMessageMetaNow(
          createdAt,
          durationStart,
          timestampFormat,
          nowMs,
        );
      }
    };
    if (!durationStart) {
      updateText(Date.now());
      return;
    }
    return visibleSecondTicker.subscribe(updateText);
  }, [createdAt, durationStart, timestampFormat]);

  return <span ref={textRef}>{initialText}</span>;
}

// ---------------------------------------------------------------------------
// Extracted row sections — own their state / store subscriptions so changes
// re-render only the affected row, not the entire list.
// ---------------------------------------------------------------------------

const COMPACT_WORK_ROW_CLASS_NAME =
  "grid min-h-[30px] w-full grid-cols-[1.25rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-md px-2 text-left";

/** Renders one already-derived group while individual entry state stays row-local. */
const WorkGroupSection = memo(function WorkGroupSection({
  groupedEntries,
}: {
  groupedEntries: Extract<MessagesTimelineRow, { kind: "work" }>["groupedEntries"];
}) {
  const { activeTurnId, isWorking } = use(TimelineStreamingCtx);
  const { workspaceRoot } = use(TimelineStableCtx);
  const onlyToolEntries = groupedEntries.every((entry) => entry.tone === "tool");
  const groupLabel = onlyToolEntries ? "Tool calls" : "Work log";

  return (
    <div className="space-y-1">
      {!onlyToolEntries && (
        <div className="flex items-center gap-2 px-2">
          <p className="text-[9px] uppercase tracking-[0.16em] text-muted-foreground/55">
            {groupLabel} ({groupedEntries.length})
          </p>
        </div>
      )}
      <div className="space-y-0.5">
        {groupedEntries.map((workEntry) => {
          const isActive =
            isWorking &&
            activeTurnId !== null &&
            activeTurnId !== undefined &&
            workEntry.turnId === activeTurnId;

          if (isFileEditWorkEntry(workEntry) && (workEntry.changedFiles?.length ?? 0) > 0) {
            return (
              <FileEditWorkEntryRow
                key={`work-row:${workEntry.id}`}
                isEditing={isActive && !workEntry.completed && !isErroredWorkEntry(workEntry)}
                workEntry={workEntry}
                workspaceRoot={workspaceRoot}
              />
            );
          }

          return (
            <ExpandableWorkEntryRow
              key={`work-row:${workEntry.id}`}
              workEntry={workEntry}
              workspaceRoot={workspaceRoot}
            />
          );
        })}
      </div>
    </div>
  );
});

function WorkGroupToggleTimelineRow({
  row,
}: {
  row: Extract<TimelineRow, { kind: "work-toggle" }>;
}) {
  const { routeThreadKey } = use(TimelineStableCtx);
  const setExpanded = useUiStateStore((store) => store.setThreadWorkGroupExpanded);
  const labelNoun = row.onlyToolEntries
    ? row.hiddenCount === 1
      ? "tool call"
      : "tool calls"
    : row.hiddenCount === 1
      ? "log entry"
      : "log entries";

  return (
    <button
      type="button"
      aria-expanded={row.expanded}
      onClick={() => setExpanded(routeThreadKey, row.groupId, !row.expanded)}
      data-work-group-toggle="true"
      className={cn(
        COMPACT_WORK_ROW_CLASS_NAME,
        "cursor-pointer text-[11px] leading-5 transition-colors duration-150 hover:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
      )}
    >
      <span className="flex size-5 items-center justify-center text-muted-foreground/65">
        <ChevronDownIcon
          className={cn(
            "size-3.5 opacity-70 transition-transform duration-200",
            row.expanded && "rotate-180",
          )}
          aria-hidden
        />
      </span>
      <span className="font-medium text-foreground/82">
        {row.expanded
          ? `Show fewer ${row.onlyToolEntries ? "tool calls" : "log entries"}`
          : `+${row.hiddenCount} previous ${labelNoun}`}
      </span>
      <span className="size-5" aria-hidden />
    </button>
  );
}

const ContextCompactionMarkerRow = memo(function ContextCompactionMarkerRow({
  createdAt,
  label,
}: {
  createdAt: string;
  label: string;
}) {
  const { timestampFormat } = use(TimelineStableCtx);
  const timestamp = formatTimestamp(createdAt, timestampFormat);

  return (
    <div className="flex items-center gap-3 py-1.5" aria-label={`${label} at ${timestamp}`}>
      <span className="h-px flex-1 bg-border/55" />
      <span className="inline-flex min-w-0 max-w-full items-center gap-2 rounded-full border border-border/60 bg-muted/35 px-2.5 py-1 text-[10px] font-medium uppercase tracking-[0.14em] text-muted-foreground/75">
        <span className="size-1.5 shrink-0 rounded-full bg-muted-foreground/35" />
        <span className="truncate">{label}</span>
        <span className="shrink-0 font-normal normal-case tracking-normal text-muted-foreground/45">
          {timestamp}
        </span>
      </span>
      <span className="h-px flex-1 bg-border/55" />
    </div>
  );
});

/** Subscribes directly to the UI state store for expand/collapse state,
 *  so toggling re-renders only this component — not the entire list. */
const AssistantChangedFilesSection = memo(function AssistantChangedFilesSection({
  turnSummary,
  routeThreadKey,
  resolvedTheme,
  openDiffTurnId,
  onOpenTurnDiff,
  onCloseDiff,
}: {
  turnSummary: TurnDiffSummary | undefined;
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  openDiffTurnId: TurnId | null;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onCloseDiff: () => void;
}) {
  if (!turnSummary) return null;
  const checkpointFiles = turnSummary.files;
  if (checkpointFiles.length === 0) return null;

  return (
    <AssistantChangedFilesSectionInner
      turnSummary={turnSummary}
      checkpointFiles={checkpointFiles}
      routeThreadKey={routeThreadKey}
      resolvedTheme={resolvedTheme}
      openDiffTurnId={openDiffTurnId}
      onOpenTurnDiff={onOpenTurnDiff}
      onCloseDiff={onCloseDiff}
    />
  );
});

/** Inner component that only mounts when there are actual changed files,
 *  so the store subscription is unconditional (no hooks after early return). */
function AssistantChangedFilesSectionInner({
  turnSummary,
  checkpointFiles,
  routeThreadKey,
  resolvedTheme,
  openDiffTurnId,
  onOpenTurnDiff,
  onCloseDiff,
}: {
  turnSummary: TurnDiffSummary;
  checkpointFiles: TurnDiffSummary["files"];
  routeThreadKey: string;
  resolvedTheme: "light" | "dark";
  openDiffTurnId: TurnId | null;
  onOpenTurnDiff: (turnId: TurnId, filePath?: string) => void;
  onCloseDiff: () => void;
}) {
  const allDirectoriesExpanded = useUiStateStore(
    (store) => store.threadChangedFilesExpandedById[routeThreadKey]?.[turnSummary.turnId] ?? true,
  );
  const setExpanded = useUiStateStore((store) => store.setThreadChangedFilesExpanded);
  const summaryStat = summarizeTurnDiffStats(checkpointFiles);
  const changedFileCountLabel = String(checkpointFiles.length);
  const diffOpenForTurn = openDiffTurnId === turnSummary.turnId;

  return (
    <div className="chat-final-diff-section mt-2 rounded-lg border border-border/80 bg-card/45 p-2.5">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <p className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground/65">
          <span>Changed files ({changedFileCountLabel})</span>
          {hasNonZeroStat(summaryStat) && (
            <>
              <span className="mx-1">•</span>
              <DiffStatLabel additions={summaryStat.additions} deletions={summaryStat.deletions} />
            </>
          )}
        </p>
        <div className="flex items-center gap-1.5">
          <Button
            type="button"
            size="xs"
            variant="outline"
            data-scroll-anchor-ignore
            onClick={() => setExpanded(routeThreadKey, turnSummary.turnId, !allDirectoriesExpanded)}
          >
            {allDirectoriesExpanded ? "Collapse all" : "Expand all"}
          </Button>
          <Button
            type="button"
            size="xs"
            variant="outline"
            onClick={() => {
              if (diffOpenForTurn) {
                onCloseDiff();
                return;
              }
              onOpenTurnDiff(turnSummary.turnId, checkpointFiles[0]?.path);
            }}
          >
            {diffOpenForTurn ? "Close diff" : "View diff"}
          </Button>
        </div>
      </div>
      <ChangedFilesTree
        key={`changed-files-tree:${turnSummary.turnId}`}
        files={checkpointFiles}
        allDirectoriesExpanded={allDirectoriesExpanded}
        resolvedTheme={resolvedTheme}
        onSelectFile={(filePath) => onOpenTurnDiff(turnSummary.turnId, filePath)}
      />
    </div>
  );
}

// ---------------------------------------------------------------------------
// Leaf components
// ---------------------------------------------------------------------------

const UserMessageTerminalContextInlineLabel = memo(
  function UserMessageTerminalContextInlineLabel(props: { context: ParsedTerminalContextEntry }) {
    const tooltipText =
      props.context.body.length > 0
        ? `${props.context.header}\n${props.context.body}`
        : props.context.header;

    return <TerminalContextInlineChip label={props.context.header} tooltipText={tooltipText} />;
  },
);

const UserMessageBody = memo(function UserMessageBody(props: {
  text: string;
  terminalContexts: ParsedTerminalContextEntry[];
  skills: ReadonlyArray<Pick<ServerProviderSkill, "name" | "displayName">>;
  searchHighlight?: Omit<SkillInlineTextSearchHighlight, "cursor" | "keyPrefix"> | undefined;
}) {
  const searchHighlightCursorRef = useRef({ occurrenceIndex: 0 });
  searchHighlightCursorRef.current.occurrenceIndex = 0;
  const searchHighlight = props.searchHighlight
    ? {
        ...props.searchHighlight,
        cursor: searchHighlightCursorRef.current,
        keyPrefix: "user-message",
      }
    : undefined;

  if (props.terminalContexts.length > 0) {
    const hasEmbeddedInlineLabels = textContainsInlineTerminalContextLabels(
      props.text,
      props.terminalContexts,
    );
    const inlinePrefix = buildInlineTerminalContextText(props.terminalContexts);
    const inlineNodes: ReactNode[] = [];

    if (hasEmbeddedInlineLabels) {
      let cursor = 0;

      for (const context of props.terminalContexts) {
        const label = formatInlineTerminalContextLabel(context.header);
        const matchIndex = props.text.indexOf(label, cursor);
        if (matchIndex === -1) {
          inlineNodes.length = 0;
          break;
        }
        if (matchIndex > cursor) {
          inlineNodes.push(
            <span key={`user-terminal-context-inline-before:${context.header}:${cursor}`}>
              <SkillInlineText
                text={props.text.slice(cursor, matchIndex)}
                skills={props.skills}
                searchHighlight={searchHighlight}
              />
            </span>,
          );
        }
        inlineNodes.push(
          <UserMessageTerminalContextInlineLabel
            key={`user-terminal-context-inline:${context.header}`}
            context={context}
          />,
        );
        cursor = matchIndex + label.length;
      }

      if (inlineNodes.length > 0) {
        if (cursor < props.text.length) {
          inlineNodes.push(
            <span key={`user-message-terminal-context-inline-rest:${cursor}`}>
              <SkillInlineText
                text={props.text.slice(cursor)}
                skills={props.skills}
                searchHighlight={searchHighlight}
              />
            </span>,
          );
        }

        return (
          <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
            {inlineNodes}
          </div>
        );
      }
    }

    for (const context of props.terminalContexts) {
      inlineNodes.push(
        <UserMessageTerminalContextInlineLabel
          key={`user-terminal-context-inline:${context.header}`}
          context={context}
        />,
      );
      inlineNodes.push(
        <span key={`user-terminal-context-inline-space:${context.header}`} aria-hidden="true">
          {" "}
        </span>,
      );
    }

    if (props.text.length > 0) {
      inlineNodes.push(
        <span key="user-message-terminal-context-inline-text">
          <SkillInlineText
            text={props.text}
            skills={props.skills}
            searchHighlight={searchHighlight}
          />
        </span>,
      );
    } else if (inlinePrefix.length === 0) {
      return null;
    }

    return (
      <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
        {inlineNodes}
      </div>
    );
  }

  if (props.text.length === 0) {
    return null;
  }

  return (
    <div className="whitespace-pre-wrap wrap-break-word text-sm leading-relaxed text-foreground">
      <SkillInlineText text={props.text} skills={props.skills} searchHighlight={searchHighlight} />
    </div>
  );
});

// ---------------------------------------------------------------------------
// Structural sharing — reuse old row references when data hasn't changed
// so LegendList (and React) can skip re-rendering unchanged items.
// ---------------------------------------------------------------------------

/** Returns a structurally-shared copy of `rows`: for each row whose content
 *  hasn't changed since last call, the previous object reference is reused. */
function useStableRows(rows: MessagesTimelineRow[]): MessagesTimelineRow[] {
  const prevState = useRef<StableMessagesTimelineRowsState>({
    byId: new Map<string, MessagesTimelineRow>(),
    result: [],
  });

  return useMemo(() => {
    const nextState = computeStableMessagesTimelineRows(rows, prevState.current);
    prevState.current = nextState;
    return nextState.result;
  }, [rows]);
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

type TimelineMessageRow = Extract<MessagesTimelineRow, { kind: "message" }>;

/** Shared by the assistant JSX and the phone long-press handler so the copy
 *  affordance and the action sheet can never disagree about availability. */
function resolveAssistantRowInProgress(
  row: TimelineMessageRow,
  ctx: Pick<TimelineStreamingState, "activeTurnInProgress" | "activeTurnId">,
): boolean {
  const assistantTurnStillInProgress =
    ctx.activeTurnInProgress &&
    ctx.activeTurnId !== null &&
    ctx.activeTurnId !== undefined &&
    row.message.turnId === ctx.activeTurnId;
  const assistantSummaryStillInProgress =
    ctx.activeTurnInProgress &&
    ctx.activeTurnId !== null &&
    ctx.activeTurnId !== undefined &&
    row.assistantTurnDiffSummary?.turnId === ctx.activeTurnId;
  return Boolean(
    row.message.streaming || assistantTurnStillInProgress || assistantSummaryStillInProgress,
  );
}

function resolveAssistantRowCopyState(
  row: TimelineMessageRow,
  ctx: Pick<TimelineStreamingState, "activeTurnInProgress" | "activeTurnId">,
): ReturnType<typeof resolveAssistantMessageCopyState> {
  return resolveAssistantMessageCopyState({
    text: row.message.text ?? null,
    showCopyButton: row.showAssistantCopyButton,
    streaming: resolveAssistantRowInProgress(row, ctx),
  });
}

function formatWorkingTimer(startIso: string, endIso: string): string | null {
  const startedAtMs = Date.parse(startIso);
  const endedAtMs = Date.parse(endIso);
  if (!Number.isFinite(startedAtMs) || !Number.isFinite(endedAtMs)) {
    return null;
  }

  const elapsedSeconds = Math.max(0, Math.floor((endedAtMs - startedAtMs) / 1000));
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s`;
  }

  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;

  if (hours > 0) {
    return minutes > 0 ? `${hours}h ${minutes}m` : `${hours}h`;
  }

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`;
}

function formatWorkingTimerNow(startIso: string, nowMs: number = Date.now()): string {
  return formatWorkingTimer(startIso, new Date(nowMs).toISOString()) ?? "0s";
}

function formatLiveMessageMetaNow(
  createdAt: string,
  durationStart: string | null | undefined,
  timestampFormat: TimestampFormat,
  nowMs: number = Date.now(),
): string {
  const elapsed = durationStart
    ? formatElapsed(durationStart, new Date(nowMs).toISOString())
    : null;
  return formatMessageMeta(createdAt, elapsed, timestampFormat);
}

function formatMessageMeta(
  createdAt: string,
  duration: string | null,
  timestampFormat: TimestampFormat,
): string {
  if (!duration) return formatTimestamp(createdAt, timestampFormat);
  return `${formatTimestamp(createdAt, timestampFormat)} • ${duration}`;
}

function workToneIcon(tone: TimelineWorkEntry["tone"]): {
  icon: LucideIcon;
  className: string;
} {
  if (tone === "error") {
    return {
      icon: CircleAlertIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "thinking") {
    return {
      icon: BotIcon,
      className: "text-foreground/92",
    };
  }
  if (tone === "info") {
    return {
      icon: CheckIcon,
      className: "text-foreground/92",
    };
  }
  return {
    icon: ZapIcon,
    className: "text-foreground/92",
  };
}

function workToneClass(tone: "thinking" | "tool" | "info" | "error"): string {
  if (tone === "error") return "text-rose-300/50 dark:text-rose-300/50";
  if (tone === "tool") return "text-muted-foreground/70";
  if (tone === "thinking") return "text-muted-foreground/50";
  return "text-muted-foreground/40";
}

function workEntryPreview(
  workEntry: Pick<TimelineWorkEntry, "detail" | "command" | "changedFiles">,
  workspaceRoot: string | undefined,
) {
  if (workEntry.command) return workEntry.command;
  if (workEntry.detail) return workEntry.detail;
  if ((workEntry.changedFiles?.length ?? 0) === 0) return null;
  const [firstPath] = workEntry.changedFiles ?? [];
  if (!firstPath) return null;
  const displayPath = formatWorkspaceRelativePath(firstPath, workspaceRoot);
  return workEntry.changedFiles!.length === 1
    ? displayPath
    : `${displayPath} +${workEntry.changedFiles!.length - 1} more`;
}

function workEntryRawCommand(
  workEntry: Pick<TimelineWorkEntry, "command" | "rawCommand">,
): string | null {
  const rawCommand = workEntry.rawCommand?.trim();
  if (!rawCommand || !workEntry.command) {
    return null;
  }
  return rawCommand === workEntry.command.trim() ? null : rawCommand;
}

function workEntryIcon(workEntry: TimelineWorkEntry): LucideIcon {
  if (workEntry.requestKind === "command") return TerminalIcon;
  if (workEntry.requestKind === "file-read") return EyeIcon;
  if (workEntry.requestKind === "file-change") return SquarePenIcon;

  if (workEntry.itemType === "command_execution" || workEntry.command) {
    return TerminalIcon;
  }
  if (workEntry.itemType === "file_change" || (workEntry.changedFiles?.length ?? 0) > 0) {
    return SquarePenIcon;
  }
  if (workEntry.itemType === "web_search") return GlobeIcon;
  if (workEntry.itemType === "image_view") return EyeIcon;

  switch (workEntry.itemType) {
    case "mcp_tool_call":
      return WrenchIcon;
    case "dynamic_tool_call":
    case "collab_agent_tool_call":
      return HammerIcon;
  }

  return workToneIcon(workEntry.tone).icon;
}

function capitalizePhrase(value: string): string {
  const trimmed = value.trim();
  if (trimmed.length === 0) {
    return value;
  }
  return `${trimmed.charAt(0).toUpperCase()}${trimmed.slice(1)}`;
}

function toolWorkEntryHeading(workEntry: TimelineWorkEntry): string {
  if (!workEntry.toolTitle) {
    return capitalizePhrase(normalizeCompactToolLabel(workEntry.label));
  }
  return capitalizePhrase(normalizeCompactToolLabel(workEntry.toolTitle));
}

function isFileEditWorkEntry(workEntry: TimelineWorkEntry): boolean {
  return (
    workEntry.requestKind === "file-change" ||
    workEntry.itemType === "file_change" ||
    (workEntry.changedFiles?.length ?? 0) > 0
  );
}

type ChangedFileStatInput = {
  additions?: number | undefined;
  deletions?: number | undefined;
};

function fileStatHasValues(file: ChangedFileStatInput): boolean {
  return typeof file.additions === "number" || typeof file.deletions === "number";
}

function summarizeChangedFileStats(
  files: ReadonlyArray<ChangedFileStatInput> | undefined,
): { additions: number; deletions: number } | null {
  if (!files?.some(fileStatHasValues)) {
    return null;
  }
  return files.reduce<{ additions: number; deletions: number }>(
    (stat, file) => ({
      additions: stat.additions + (file.additions ?? 0),
      deletions: stat.deletions + (file.deletions ?? 0),
    }),
    { additions: 0, deletions: 0 },
  );
}

function basenameFromPath(filePath: string): string {
  const normalized = filePath.replaceAll("\\", "/");
  const segments = normalized.split("/");
  for (let index = segments.length - 1; index >= 0; index -= 1) {
    const segment = segments[index];
    if (segment) {
      return segment;
    }
  }
  return filePath;
}

function CompactDiffStatLabel(props: { additions: number; deletions: number }) {
  return (
    <>
      <span className="text-success">+{props.additions}</span>
      <span className="ml-1 text-destructive">-{props.deletions}</span>
    </>
  );
}

const SimpleWorkEntryRow = memo(function SimpleWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
}) {
  const { workEntry, workspaceRoot } = props;
  const iconConfig = workToneIcon(workEntry.tone);
  const EntryIcon = workEntryIcon(workEntry);
  const heading = toolWorkEntryHeading(workEntry);
  const rawPreview = workEntryPreview(workEntry, workspaceRoot);
  const preview =
    rawPreview &&
    normalizeCompactToolLabel(rawPreview).toLowerCase() ===
      normalizeCompactToolLabel(heading).toLowerCase()
      ? null
      : rawPreview;
  const rawCommand = workEntryRawCommand(workEntry);
  const displayText = preview ? `${heading} - ${preview}` : heading;

  return (
    <>
      <span
        className={cn("flex size-5 items-center justify-center", iconConfig.className)}
        data-work-entry-icon="true"
      >
        <EntryIcon className="size-3" />
      </span>
      <div className="min-w-0 overflow-hidden transition-[opacity,translate] duration-200">
        {rawCommand ? (
          <div className="max-w-full">
            <p
              className={cn(
                "truncate text-[11px] leading-5",
                workToneClass(workEntry.tone),
                preview ? "text-muted-foreground/70" : "",
              )}
              title={displayText}
            >
              <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                {heading}
              </span>
              {preview && (
                <Tooltip>
                  <TooltipTrigger
                    closeDelay={0}
                    delay={75}
                    render={
                      <span className="max-w-full cursor-default text-muted-foreground/55 transition-colors hover:text-muted-foreground/75 focus-visible:text-muted-foreground/75">
                        {" "}
                        - {preview}
                      </span>
                    }
                  />
                  <TooltipPopup
                    align="start"
                    className="max-w-[min(56rem,calc(100vw-2rem))] px-0 py-0"
                    side="top"
                  >
                    <div className="max-w-[min(56rem,calc(100vw-2rem))] overflow-x-auto px-1.5 py-1 font-mono text-[11px] leading-4 whitespace-nowrap">
                      {rawCommand}
                    </div>
                  </TooltipPopup>
                </Tooltip>
              )}
            </p>
          </div>
        ) : (
          <Tooltip>
            <TooltipTrigger
              className="block min-w-0 w-full text-left"
              title={displayText}
              aria-label={displayText}
            >
              <p
                className={cn(
                  "truncate text-[11px] leading-5",
                  workToneClass(workEntry.tone),
                  preview ? "text-muted-foreground/70" : "",
                )}
              >
                <span className={cn("text-foreground/80", workToneClass(workEntry.tone))}>
                  {heading}
                </span>
                {preview && <span className="text-muted-foreground/55"> - {preview}</span>}
              </p>
            </TooltipTrigger>
            <TooltipPopup className="max-w-[min(720px,calc(100vw-2rem))]">
              <p className="whitespace-pre-wrap wrap-break-word text-xs leading-5">{displayText}</p>
            </TooltipPopup>
          </Tooltip>
        )}
      </div>
    </>
  );
});

const FileEditWorkEntryRow = memo(function FileEditWorkEntryRow(props: {
  isEditing: boolean;
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
}) {
  const { isEditing, workEntry, workspaceRoot } = props;
  const changedFiles = workEntry.changedFiles ?? [];
  const statsByPath = new Map(
    (workEntry.changedFileStats ?? []).map((file) => [file.path, file] as const),
  );
  const visibleFiles = changedFiles.slice(0, 3);
  const hiddenCount = Math.max(0, changedFiles.length - visibleFiles.length);
  const firstFile = changedFiles[0];
  const firstDisplayPath = firstFile ? formatWorkspaceRelativePath(firstFile, workspaceRoot) : null;
  const primaryLabel =
    changedFiles.length === 1 && firstDisplayPath
      ? `${workEntry.completed ? "Edited" : "Editing"} ${firstDisplayPath}`
      : `${workEntry.completed ? "Edited" : "Editing"} ${changedFiles.length} files`;
  const firstFileStat = firstFile ? statsByPath.get(firstFile) : undefined;
  const stat = workEntry.completed
    ? changedFiles.length === 1 && firstFile
      ? summarizeChangedFileStats(firstFileStat ? [firstFileStat] : undefined)
      : summarizeChangedFileStats(workEntry.changedFileStats)
    : null;

  return (
    <div
      className={cn(
        COMPACT_WORK_ROW_CLASS_NAME,
        "chat-file-edit-row transition-colors duration-150 hover:bg-foreground/5",
        changedFiles.length > 1 && "items-start py-1.5",
        isEditing && "bg-success/[0.045]",
      )}
      data-tool-entry-row="true"
      data-tool-entry-kind="file-edit"
      data-file-edit-work-row="true"
      data-file-edit-work-state={workEntry.completed ? "completed" : "editing"}
    >
      <span
        className={cn(
          "flex size-5 items-center justify-center text-muted-foreground/75",
          changedFiles.length > 1 && "mt-0.5",
          isEditing && "text-success/85",
        )}
        data-work-entry-icon="true"
      >
        <SquarePenIcon className="size-3" />
      </span>
      <div className="min-w-0">
        <p
          className={cn(
            "chat-file-edit-text truncate text-[11px] leading-5 font-medium text-foreground/80",
            isEditing && "chat-file-edit-text--active",
          )}
          title={primaryLabel}
        >
          {primaryLabel}
        </p>
        {changedFiles.length > 1 && (
          <div className="mt-0.5 flex min-w-0 flex-nowrap gap-1 overflow-hidden">
            {visibleFiles.map((filePath) => {
              const displayPath = formatWorkspaceRelativePath(filePath, workspaceRoot);
              const rawFileStat = statsByPath.get(filePath);
              const fileStat = summarizeChangedFileStats(rawFileStat ? [rawFileStat] : undefined);
              return (
                <span
                  key={`${workEntry.id}:edit-chip:${filePath}`}
                  className="inline-flex min-w-0 max-w-[15rem] items-center gap-1 rounded border border-border/45 px-1.5 py-0.5 font-mono text-[9px] leading-3 text-muted-foreground/70"
                  title={displayPath}
                >
                  <span className="truncate">{basenameFromPath(displayPath)}</span>
                  {fileStat && (
                    <span className="shrink-0">
                      <CompactDiffStatLabel
                        additions={fileStat.additions}
                        deletions={fileStat.deletions}
                      />
                    </span>
                  )}
                </span>
              );
            })}
            {hiddenCount > 0 && (
              <span className="shrink-0 px-1 text-[10px] leading-4 text-muted-foreground/55">
                +{hiddenCount}
              </span>
            )}
          </div>
        )}
      </div>
      {stat ? (
        <span className={cn("shrink-0 font-mono text-[10px]", changedFiles.length > 1 && "mt-1")}>
          <CompactDiffStatLabel additions={stat.additions} deletions={stat.deletions} />
        </span>
      ) : (
        <span className="size-5" aria-hidden />
      )}
    </div>
  );
});

// ---------------------------------------------------------------------------
// Expandable wrapper — renders a SimpleWorkEntryRow as a click target with
// a trailing chevron, conditionally mounting WorkEntryExpandedPanel below.
// ---------------------------------------------------------------------------

const ANSI_SGR_RE = new RegExp(String.raw`\u001b\[[0-9;]*m`, "g");

function workEntryExpandPanelId(entryId: string): string {
  return `work-entry-panel:${entryId}`;
}

const ExpandableWorkEntryRow = memo(function ExpandableWorkEntryRow(props: {
  workEntry: TimelineWorkEntry;
  workspaceRoot: string | undefined;
}) {
  const { workEntry, workspaceRoot } = props;
  const { routeThreadKey } = use(TimelineStableCtx);
  const stored = useUiStateStore(
    (store) => store.threadWorkEntryExpandedById[routeThreadKey]?.[workEntry.id],
  );
  const setExpanded = useUiStateStore((store) => store.setThreadWorkEntryExpanded);
  const isOpen = stored ?? isErroredWorkEntry(workEntry);
  const panelId = workEntryExpandPanelId(workEntry.id);
  const heading = toolWorkEntryHeading(workEntry);
  const toggle = () => {
    setExpanded(routeThreadKey, workEntry.id, !isOpen);
  };

  return (
    <div>
      <div
        role="button"
        tabIndex={0}
        aria-expanded={isOpen}
        aria-controls={panelId}
        onClick={toggle}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            toggle();
          }
        }}
        data-tool-entry-row="true"
        data-tool-entry-kind="expandable"
        className={cn(
          COMPACT_WORK_ROW_CLASS_NAME,
          "cursor-pointer transition-colors duration-150 hover:bg-foreground/5 focus-visible:bg-foreground/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring/70",
        )}
      >
        <SimpleWorkEntryRow workEntry={workEntry} workspaceRoot={workspaceRoot} />
        <span className="flex size-5 items-center justify-center">
          <ChevronRightIcon
            aria-hidden
            className={cn(
              "size-3 text-muted-foreground/55 transition-transform duration-150",
              isOpen ? "rotate-90" : "",
            )}
          />
        </span>
      </div>
      {isOpen && (
        <WorkEntryExpandedPanel workEntry={workEntry} panelId={panelId} headingLabel={heading} />
      )}
    </div>
  );
});

const WorkEntryExpandedPanel = memo(function WorkEntryExpandedPanel(props: {
  workEntry: TimelineWorkEntry;
  panelId: string;
  headingLabel: string;
}) {
  const { workEntry, panelId, headingLabel } = props;
  const inputLine = workEntry.rawCommand?.trim() || workEntry.command?.trim() || null;
  const cleanedOutput = workEntry.output ? workEntry.output.replace(ANSI_SGR_RE, "") : "";
  const hasOutput = cleanedOutput.length > 0;
  const showExitChip = workEntry.exitCode !== undefined && workEntry.exitCode !== 0;
  // The collapsed row truncates its detail and reveals the full text only in
  // a hover tooltip; on phone the expanded panel carries the full text
  // instead so tooltip-only content stays reachable by tap.
  const phoneDetailText = workEntry.detail?.trim() || null;

  return (
    <div
      id={panelId}
      role="region"
      aria-label={`${headingLabel} details`}
      className="mt-1 border-t border-border/40 pt-1.5 pl-9"
    >
      {phoneDetailText && phoneDetailText !== inputLine && (
        <p
          data-work-entry-phone-detail="true"
          className="hidden whitespace-pre-wrap wrap-break-word pb-1 text-[11px] leading-4 text-foreground/85 phone:block"
        >
          {phoneDetailText}
        </p>
      )}
      {inputLine && (
        <div className="flex items-start gap-1.5 overflow-x-auto">
          <span className="mt-0.5 shrink-0 font-mono text-[10px] text-muted-foreground/55">
            {">_"}
          </span>
          <pre className="font-mono text-[11px] leading-4 text-foreground/85 whitespace-nowrap">
            {inputLine}
          </pre>
        </div>
      )}
      <div className={cn("flex flex-col gap-1", inputLine ? "mt-1.5" : "")}>
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/60">
          Output:
        </span>
        {hasOutput ? (
          <pre className="max-h-[400px] overflow-auto rounded-md border border-border/40 bg-background/40 p-1.5 font-mono text-[11px] leading-4 whitespace-pre text-foreground/85">
            {cleanedOutput}
          </pre>
        ) : (
          <span className="italic text-muted-foreground/40">(no output)</span>
        )}
      </div>
      <div className="mt-1.5 flex items-center justify-between">
        {showExitChip ? (
          <span className="rounded-md border border-rose-500/30 bg-rose-500/10 px-1.5 py-0.5 font-mono text-[10px] text-rose-300">
            exit {workEntry.exitCode}
          </span>
        ) : (
          <span />
        )}
        {hasOutput && (
          <MessageCopyButton
            text={cleanedOutput}
            size="icon-xs"
            ariaLabel="Copy output"
            className="border-border/40 bg-background/40 text-muted-foreground/60 shadow-none hover:text-foreground/80"
          />
        )}
      </div>
    </div>
  );
});
