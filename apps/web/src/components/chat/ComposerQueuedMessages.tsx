import { memo } from "react";
import { ChevronDownIcon, ChevronUpIcon, XIcon } from "lucide-react";

import { cn } from "~/lib/utils";
import { summarizeQueuedMessage, type QueuedMessage } from "~/messageQueue.logic";

interface ComposerQueuedMessagesProps {
  messages: readonly QueuedMessage[];
  onRemove: (id: string) => void;
  onMove: (id: string, direction: "up" | "down") => void;
}

const iconButtonClass = cn(
  "inline-flex size-6 shrink-0 items-center justify-center rounded-md text-muted-foreground/80",
  "transition-colors hover:text-foreground disabled:pointer-events-none disabled:opacity-40",
  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring",
);

/**
 * Compact list of messages queued while a turn is running. Each row can be
 * reordered or removed before it auto-sends on quiescence.
 */
export const ComposerQueuedMessages = memo(function ComposerQueuedMessages({
  messages,
  onRemove,
  onMove,
}: ComposerQueuedMessagesProps) {
  if (messages.length === 0) {
    return null;
  }

  return (
    <div className="mb-2 rounded-lg border border-border/60 bg-muted/30 p-1.5">
      <div className="px-1.5 pb-1 text-[11px] font-medium uppercase tracking-wide text-muted-foreground">
        Queued · {messages.length}
      </div>
      <ul className="flex flex-col gap-0.5">
        {messages.map((message, index) => (
          <li
            key={message.id}
            className="flex items-center gap-1 rounded-md px-1.5 py-1 hover:bg-muted/50"
          >
            <span className="min-w-0 flex-1 truncate text-xs text-foreground">
              {summarizeQueuedMessage(message)}
            </span>
            <button
              type="button"
              className={iconButtonClass}
              disabled={index === 0}
              onClick={() => onMove(message.id, "up")}
              aria-label="Move queued message up"
            >
              <ChevronUpIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className={iconButtonClass}
              disabled={index === messages.length - 1}
              onClick={() => onMove(message.id, "down")}
              aria-label="Move queued message down"
            >
              <ChevronDownIcon className="size-3.5" />
            </button>
            <button
              type="button"
              className={iconButtonClass}
              onClick={() => onRemove(message.id)}
              aria-label="Remove queued message"
            >
              <XIcon className="size-3.5" />
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
});
