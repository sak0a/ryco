import { memo, useLayoutEffect, useRef, useState } from "react";
import { cn } from "~/lib/utils";

export type IssueStateFilter = "open" | "closed" | "all";
export type ChangeRequestStateFilter = "open" | "closed" | "merged" | "all";

const issueOptions: ReadonlyArray<{ id: IssueStateFilter; label: string }> = [
  { id: "open", label: "Open" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

const changeRequestOptions: ReadonlyArray<{ id: ChangeRequestStateFilter; label: string }> = [
  { id: "open", label: "Open" },
  { id: "merged", label: "Merged" },
  { id: "closed", label: "Closed" },
  { id: "all", label: "All" },
];

function FilterPills<T extends string>(props: {
  value: T;
  options: ReadonlyArray<{ id: T; label: string }>;
  onChange: (value: T) => void;
}) {
  const filterRef = useRef<HTMLDivElement>(null);
  const [indicatorStyle, setIndicatorStyle] = useState({ width: 0, x: 0, visible: false });

  useLayoutEffect(() => {
    const filter = filterRef.current;
    if (!filter) return;
    const activeFilter = filter.querySelector<HTMLElement>(
      `[data-state-filter-id="${CSS.escape(props.value)}"]`,
    );
    if (!activeFilter) {
      setIndicatorStyle((current) => ({ ...current, visible: false }));
      return;
    }
    setIndicatorStyle({
      width: activeFilter.offsetWidth,
      x: activeFilter.offsetLeft,
      visible: true,
    });
  }, [props.options, props.value]);

  return (
    <div
      ref={filterRef}
      className="relative isolate flex items-center gap-0.5 rounded-md border border-border/60 bg-muted/40 p-0.5"
    >
      <span
        className={cn(
          "pointer-events-none absolute top-0.5 bottom-0.5 left-0 z-0 rounded bg-background shadow-sm transition-[transform,width,opacity] duration-[240ms] ease-out",
          indicatorStyle.visible ? "opacity-100" : "opacity-0",
        )}
        style={{
          width: indicatorStyle.width,
          transform: `translateX(${indicatorStyle.x}px)`,
        }}
        aria-hidden
      />
      {props.options.map((option) => (
        <button
          key={option.id}
          type="button"
          onClick={() => props.onChange(option.id)}
          aria-pressed={props.value === option.id}
          data-state-filter-id={option.id}
          className={cn(
            "relative z-10 rounded px-2 py-0.5 text-xs transition-colors duration-150",
            props.value === option.id
              ? "text-foreground"
              : "text-muted-foreground hover:text-foreground",
          )}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export const StateFilterButtons = memo(function StateFilterButtons(props: {
  value: IssueStateFilter;
  onChange: (value: IssueStateFilter) => void;
}) {
  return (
    <FilterPills<IssueStateFilter>
      value={props.value}
      options={issueOptions}
      onChange={props.onChange}
    />
  );
});

export const ChangeRequestStateFilterButtons = memo(
  function ChangeRequestStateFilterButtons(props: {
    value: ChangeRequestStateFilter;
    onChange: (value: ChangeRequestStateFilter) => void;
  }) {
    return (
      <FilterPills<ChangeRequestStateFilter>
        value={props.value}
        options={changeRequestOptions}
        onChange={props.onChange}
      />
    );
  },
);
