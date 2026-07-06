import { Loader2Icon } from "lucide-react";
import { cn } from "~/lib/utils";
import { Badge } from "../ui/badge";
import { Button } from "../ui/button";
import type { ItemAction, ItemActionKind } from "./itemActions";

/**
 * Needs-attention banner rendered between a detail view's header and tab
 * strip: one row per applicable action, each with its own fix button that
 * spawns a prefilled agent draft. The most severe action gets the primary
 * button style.
 */
export function NeedsAttentionBanner(props: {
  actions: ReadonlyArray<ItemAction>;
  busyActionKind: ItemActionKind | null;
  onRun: (action: ItemAction) => void;
}) {
  if (props.actions.length === 0) {
    return null;
  }
  const primaryKind =
    props.actions.find((action) => action.severity === "error")?.kind ?? props.actions[0]?.kind;
  return (
    <div className="mx-4 mb-3 flex flex-col gap-2 rounded-lg border border-warning/40 bg-warning/8 px-3 py-2.5">
      {props.actions.map((action) => {
        const isBusy = props.busyActionKind === action.kind;
        return (
          <div key={action.kind} className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 items-center gap-2 text-sm">
              <Badge variant={action.severity === "error" ? "error" : "warning"} size="sm">
                {action.badge}
              </Badge>
              <span className="min-w-0 truncate text-foreground/85">{action.summary}</span>
            </div>
            <Button
              type="button"
              size="xs"
              variant={action.kind === primaryKind ? "default" : "outline"}
              className={cn("shrink-0", isBusy && "pointer-events-none opacity-70")}
              disabled={props.busyActionKind !== null && !isBusy}
              onClick={() => props.onRun(action)}
            >
              {isBusy ? <Loader2Icon className="size-3.5 animate-spin" aria-hidden /> : null}
              {action.label}
            </Button>
          </div>
        );
      })}
    </div>
  );
}
