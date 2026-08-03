import { memo, useLayoutEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

export type ContextPickerTab = {
  id: string;
  label: string;
  count?: number;
};

export const ContextPickerTabs = memo(function ContextPickerTabs(props: {
  tabs: ReadonlyArray<ContextPickerTab>;
  activeId: string;
  onSelect: (id: string) => void;
  /** Tightens the strip for popovers, where the dialog inset is too generous. */
  density?: "default" | "compact";
}) {
  const tablistRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, x: 0, visible: false });

  useLayoutEffect(() => {
    const tablist = tablistRef.current;
    if (!tablist) return;
    const activeTab = tablist.querySelector<HTMLElement>(
      `[data-context-picker-tab-id="${CSS.escape(props.activeId)}"]`,
    );
    if (!activeTab) {
      setIndicatorStyle((current) => ({ ...current, visible: false }));
      return;
    }
    setIndicatorStyle({
      width: activeTab.offsetWidth,
      x: activeTab.offsetLeft,
      visible: true,
    });
  }, [props.activeId, props.tabs]);

  return (
    <div
      ref={tablistRef}
      role="tablist"
      className={cn(
        "relative isolate flex gap-1 border-border border-b",
        props.density === "compact" ? "px-1.5 py-1" : "px-3 py-1.5",
      )}
    >
      <span
        className={cn(
          "pointer-events-none absolute top-1.5 bottom-1.5 left-0 z-0 rounded-md bg-accent transition-[transform,width,opacity] duration-[240ms] ease-out",
          indicatorStyle.visible ? "opacity-100" : "opacity-0",
        )}
        style={{
          width: indicatorStyle.width,
          transform: `translateX(${indicatorStyle.x}px)`,
        }}
        aria-hidden
      />
      {props.tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          role="tab"
          aria-selected={props.activeId === tab.id}
          data-context-picker-tab-id={tab.id}
          onClick={() => props.onSelect(tab.id)}
          className={cn(
            "relative z-10 rounded-md px-2 py-1 text-xs transition-colors duration-150",
            props.activeId === tab.id
              ? "text-accent-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {tab.label}
          {typeof tab.count === "number" ? (
            <span className="ml-1 opacity-60">{tab.count}</span>
          ) : null}
        </button>
      ))}
    </div>
  );
});
