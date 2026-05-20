import type { SourceControlAssigneeCandidate } from "@ryco/contracts";
import { useState } from "react";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface IssueAssigneePickerProps {
  available: ReadonlyArray<SourceControlAssigneeCandidate>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function IssueAssigneePicker(props: IssueAssigneePickerProps) {
  const [query, setQuery] = useState("");
  const lower = query.toLowerCase();
  const visible = props.available.filter(
    (a) =>
      a.login.toLowerCase().includes(lower) ||
      (a.displayName?.toLowerCase().includes(lower) ?? false),
  );
  const toggle = (login: string) => {
    const has = props.selected.includes(login);
    props.onChange(has ? props.selected.filter((l) => l !== login) : [...props.selected, login]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.selected.map((login) => (
        <button
          key={login}
          type="button"
          onClick={() => toggle(login)}
          className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
        >
          @{login}
        </button>
      ))}
      <Popover>
        <PopoverTrigger className="rounded-full border border-border border-dashed px-2 py-0.5 text-muted-foreground text-xs">
          + assign
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter people…"
            className="m-2 h-8 text-sm"
          />
          <div className="max-h-60 overflow-y-auto">
            {props.isLoading ? (
              <p className="px-3 py-2 text-muted-foreground text-xs">Loading assignees…</p>
            ) : props.error ? (
              <p className="px-3 py-2 text-destructive text-xs">
                Failed to load assignees: {props.error}
              </p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground text-xs">
                {query ? "No matching people." : "No assignable users for this repository."}
              </p>
            ) : (
              visible.map((a) => (
                <button
                  key={a.login}
                  type="button"
                  onClick={() => toggle(a.login)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted/60 ${
                    props.selected.includes(a.login) ? "bg-muted/80" : ""
                  }`}
                >
                  <span>
                    @{a.login}
                    {a.displayName ? (
                      <span className="text-muted-foreground"> — {a.displayName}</span>
                    ) : null}
                  </span>
                  {props.selected.includes(a.login) ? <span className="text-xs">✓</span> : null}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
