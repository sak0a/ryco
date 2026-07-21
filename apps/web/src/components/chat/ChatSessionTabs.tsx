import { PlusIcon } from "lucide-react";
import { memo, useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";
import type { SidebarStatusBucket } from "../Sidebar.logic";
import { tabKeyboardHint } from "./ChatSessionTabs.logic";

const PENDING_TAB_TIMEOUT_MS = 500;

const BUCKET_DOT: Record<SidebarStatusBucket, string> = {
  done: "bg-muted-foreground/45",
  idle: "bg-muted-foreground/30",
  in_progress: "bg-sky-500 dark:bg-sky-300/80",
  review: "bg-amber-500 dark:bg-amber-300/90",
};

export interface ChatSessionTabsItem {
  key: string;
  title: string;
  bucket: SidebarStatusBucket;
}

export interface ChatSessionTabsProps {
  items: ReadonlyArray<ChatSessionTabsItem>;
  activeKey: string | null;
  onSelect: (key: string) => void;
  onPrefetchEnter?: ((key: string) => void) | undefined;
  onPrefetchLeave?: ((key: string) => void) | undefined;
  onNew?: (() => void) | undefined;
}

export const ChatSessionTabs = memo(function ChatSessionTabs(props: ChatSessionTabsProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const [pendingKey, setPendingKey] = useState<string | null>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, x: 0, visible: false });
  const displayedActiveKey = pendingKey ?? props.activeKey;

  useEffect(() => {
    if (pendingKey === null) return;
    if (props.activeKey === pendingKey) {
      setPendingKey(null);
      return;
    }
    const timeout = setTimeout(() => setPendingKey(null), PENDING_TAB_TIMEOUT_MS);
    return () => clearTimeout(timeout);
  }, [pendingKey, props.activeKey]);

  useEffect(() => {
    if (!containerRef.current || displayedActiveKey === null) return;
    const active = containerRef.current.querySelector<HTMLElement>(
      `[data-session-tab-key="${CSS.escape(displayedActiveKey)}"]`,
    );
    if (active) {
      active.scrollIntoView({ block: "nearest", inline: "nearest" });
    }
  }, [displayedActiveKey]);

  useLayoutEffect(() => {
    const container = containerRef.current;
    if (!container || displayedActiveKey === null) {
      setIndicatorStyle((current) => ({ ...current, visible: false }));
      return;
    }
    const active = container.querySelector<HTMLElement>(
      `[data-session-tab-key="${CSS.escape(displayedActiveKey)}"]`,
    );
    if (!active) {
      setIndicatorStyle((current) => ({ ...current, visible: false }));
      return;
    }
    setIndicatorStyle({
      width: active.offsetWidth,
      x: active.offsetLeft,
      visible: true,
    });
  }, [displayedActiveKey, props.items]);

  if (props.items.length === 0) return null;

  return (
    <div
      ref={containerRef}
      role="tablist"
      aria-label="Sessions in this worktree"
      className="-mb-px relative isolate flex min-h-7 shrink-0 items-end gap-0.5 overflow-x-auto [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
    >
      <span
        className={cn(
          "pointer-events-none absolute bottom-0 left-0 z-0 h-7 rounded-t-md border border-b-0 border-border/60 bg-background transition-[transform,width,opacity] duration-[240ms] ease-out",
          indicatorStyle.visible ? "opacity-100" : "opacity-0",
        )}
        style={{
          width: indicatorStyle.width,
          transform: `translateX(${indicatorStyle.x}px)`,
        }}
        aria-hidden
      />
      {props.items.map((item, index) => {
        const isActive = item.key === displayedActiveKey;
        const hint = tabKeyboardHint(index);
        const prefetchEnter =
          !isActive && props.onPrefetchEnter ? () => props.onPrefetchEnter?.(item.key) : undefined;
        const prefetchLeave =
          !isActive && props.onPrefetchLeave ? () => props.onPrefetchLeave?.(item.key) : undefined;
        return (
          <button
            key={item.key}
            type="button"
            role="tab"
            aria-selected={isActive}
            data-session-tab-key={item.key}
            onClick={() => {
              if (item.key !== props.activeKey) setPendingKey(item.key);
              props.onSelect(item.key);
            }}
            onPointerEnter={prefetchEnter}
            onFocus={prefetchEnter}
            onPointerLeave={prefetchLeave}
            onBlur={prefetchLeave}
            className={cn(
              "group/tab relative z-10 inline-flex h-7 shrink-0 items-center gap-1.5 rounded-t-md border border-b-0 px-2.5 text-xs transition-colors duration-150",
              isActive
                ? "border-transparent text-foreground"
                : "border-transparent text-muted-foreground hover:bg-accent/40 hover:text-foreground",
            )}
            title={item.title}
          >
            <span
              aria-hidden
              className={cn(
                "inline-flex size-2 shrink-0 items-center justify-center",
                item.bucket === "in_progress" ? "animate-pulse" : "",
              )}
            >
              <span className={cn("size-1.5 rounded-full", BUCKET_DOT[item.bucket])} />
            </span>
            {hint ? (
              <kbd className="shrink-0 rounded border border-border/60 bg-muted/40 px-1 font-mono text-[9px] text-muted-foreground/80 pointer-coarse:hidden">
                {hint}
              </kbd>
            ) : null}
            <span className="min-w-0 max-w-40 truncate">{item.title}</span>
          </button>
        );
      })}
      {props.onNew ? (
        <button
          type="button"
          aria-label="New session in this worktree"
          title="New session in this worktree"
          onClick={props.onNew}
          className="ml-1 inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/60 hover:bg-secondary hover:text-foreground"
        >
          <PlusIcon className="size-3.5" />
        </button>
      ) : null}
    </div>
  );
});
