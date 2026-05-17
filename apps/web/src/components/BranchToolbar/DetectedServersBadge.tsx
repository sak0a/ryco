import { Server } from "lucide-react";
import type { DetectedServer } from "@ryco/contracts";
import { Tooltip, TooltipPopup, TooltipTrigger } from "../ui/tooltip";

interface Props {
  servers: DetectedServer[];
  onClick: () => void;
}

export const DetectedServersBadge = ({ servers, onClick }: Props) => {
  if (servers.length === 0) return null;
  const isPulsing = servers.some((s) => s.status === "predicted" || s.status === "candidate");
  return (
    <Tooltip>
      <TooltipTrigger
        render={
          <button
            type="button"
            onClick={onClick}
            data-state={isPulsing ? "pulsing" : "idle"}
            className="inline-flex items-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-xs text-foreground hover:bg-accent data-[state=pulsing]:animate-pulse"
          >
            <Server className="h-3.5 w-3.5" />
            <span className="tabular-nums">{servers.length}</span>
          </button>
        }
      />
      <TooltipPopup side="top">
        <ul className="space-y-0.5">
          {servers.map((s) => (
            <li key={s.id} className="text-xs">
              <span className="font-medium">{s.framework}</span>
              {s.url ? <span> · {s.url}</span> : null}
              <span className="ml-1 text-muted-foreground"> · {s.status}</span>
            </li>
          ))}
        </ul>
      </TooltipPopup>
    </Tooltip>
  );
};
