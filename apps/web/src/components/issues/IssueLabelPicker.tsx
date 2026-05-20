import type { SourceControlLabel } from "@ryco/contracts";
import { useState } from "react";
import { Input } from "../ui/input";
import { Popover, PopoverContent, PopoverTrigger } from "../ui/popover";

interface IssueLabelPickerProps {
  available: ReadonlyArray<SourceControlLabel>;
  selected: ReadonlyArray<string>;
  onChange: (next: ReadonlyArray<string>) => void;
  isLoading?: boolean;
  error?: string | null;
}

export function IssueLabelPicker(props: IssueLabelPickerProps) {
  const [query, setQuery] = useState("");
  const visible = props.available.filter((l) => l.name.toLowerCase().includes(query.toLowerCase()));
  const toggle = (name: string) => {
    const has = props.selected.includes(name);
    props.onChange(has ? props.selected.filter((n) => n !== name) : [...props.selected, name]);
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {props.selected.map((name) => {
        const label = props.available.find((l) => l.name === name);
        return (
          <button
            key={name}
            type="button"
            onClick={() => toggle(name)}
            className="rounded-full border border-border bg-muted/50 px-2 py-0.5 text-xs"
            style={label?.color ? { borderColor: `#${label.color}` } : undefined}
          >
            {name}
          </button>
        );
      })}
      <Popover>
        <PopoverTrigger className="rounded-full border border-border border-dashed px-2 py-0.5 text-muted-foreground text-xs">
          + add label
        </PopoverTrigger>
        <PopoverContent className="w-64 p-0">
          <Input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Filter labels…"
            className="m-2 h-8 text-sm"
          />
          <div className="max-h-60 overflow-y-auto">
            {props.isLoading ? (
              <p className="px-3 py-2 text-muted-foreground text-xs">Loading labels…</p>
            ) : props.error ? (
              <p className="px-3 py-2 text-destructive text-xs">
                Failed to load labels: {props.error}
              </p>
            ) : visible.length === 0 ? (
              <p className="px-3 py-2 text-muted-foreground text-xs">
                {query ? "No matching labels." : "No labels defined in this repository."}
              </p>
            ) : (
              visible.map((label) => (
                <button
                  key={label.name}
                  type="button"
                  onClick={() => toggle(label.name)}
                  className={`flex w-full items-center justify-between px-3 py-1.5 text-left text-sm hover:bg-muted/60 ${
                    props.selected.includes(label.name) ? "bg-muted/80" : ""
                  }`}
                >
                  <span>{label.name}</span>
                  {props.selected.includes(label.name) ? <span className="text-xs">✓</span> : null}
                </button>
              ))
            )}
          </div>
        </PopoverContent>
      </Popover>
    </div>
  );
}
