import { Server, ExternalLink, Square, Copy } from "lucide-react";
import type { DetectedServer } from "@ryco/contracts";
import { cn } from "~/lib/utils";

const STATUS_PILL_CLASS: Record<DetectedServer["status"], string> = {
  predicted: "bg-blue-500/20 text-blue-300",
  candidate: "bg-yellow-500/20 text-yellow-300 animate-pulse",
  confirmed: "bg-cyan-500/20 text-cyan-300",
  live: "bg-green-500/20 text-green-300",
  restarting: "bg-orange-500/20 text-orange-300 animate-pulse",
  exited: "bg-muted text-muted-foreground",
  crashed: "bg-red-500/20 text-red-300",
};

interface Props {
  server: DetectedServer;
  active: boolean;
  onSelect: () => void;
  onOpen: () => void;
  onCopy: () => void;
  onStop: () => void;
}

export const DetectedServerRow = ({ server, active, onSelect, onOpen, onCopy, onStop }: Props) => (
  <div
    role="button"
    tabIndex={0}
    onClick={onSelect}
    onKeyDown={(e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelect();
      }
    }}
    className={cn(
      "group flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-xs hover:bg-accent",
      active && "bg-accent",
    )}
  >
    <Server className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
    <div className="flex min-w-0 flex-1 flex-col">
      <div className="flex items-center gap-1.5">
        <span className="font-medium">{server.framework}</span>
        <span className={cn("rounded px-1.5 py-0.5 text-[10px]", STATUS_PILL_CLASS[server.status])}>
          {server.status}
        </span>
      </div>
      <div className="truncate text-muted-foreground">{server.url ?? "—"}</div>
    </div>
    <div className="flex shrink-0 items-center gap-0.5 opacity-0 group-hover:opacity-100">
      {server.url && (
        <button
          type="button"
          aria-label="Open in browser"
          className="rounded p-1 hover:bg-background"
          onClick={(e) => {
            e.stopPropagation();
            onOpen();
          }}
        >
          <ExternalLink className="h-3.5 w-3.5" />
        </button>
      )}
      {server.url && (
        <button
          type="button"
          aria-label="Copy URL"
          className="rounded p-1 hover:bg-background"
          onClick={(e) => {
            e.stopPropagation();
            onCopy();
          }}
        >
          <Copy className="h-3.5 w-3.5" />
        </button>
      )}
      <button
        type="button"
        aria-label="Stop"
        disabled={server.status === "exited" || server.status === "crashed"}
        className="rounded p-1 hover:bg-background disabled:opacity-30"
        onClick={(e) => {
          e.stopPropagation();
          onStop();
        }}
      >
        <Square className="h-3.5 w-3.5" />
      </button>
    </div>
  </div>
);
