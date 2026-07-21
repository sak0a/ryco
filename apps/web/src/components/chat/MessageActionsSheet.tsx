import { CopyIcon, Undo2Icon } from "lucide-react";

import { useCopyToClipboard } from "~/hooks/useCopyToClipboard";
import { stackedThreadToast, toastManager } from "../ui/toast";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../ui/sheet";

export interface MessageActionsSheetTarget {
  readonly role: "user" | "assistant";
  readonly copyText: string | null;
  readonly canRevert: boolean;
}

const ROW_CLASS_NAME =
  "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/60";

/**
 * Phone bottom-sheet for message actions opened by long-pressing a message.
 * Mirrors the hover-revealed desktop row exactly: copy (user), copy response
 * (assistant), and revert-to-checkpoint (user, when a checkpoint exists) —
 * all dispatched through the same handlers the desktop buttons use.
 */
export function MessageActionsSheet({
  target,
  onOpenChange,
  revertDisabled,
  onRevert,
}: {
  readonly target: MessageActionsSheetTarget | null;
  readonly onOpenChange: (open: boolean) => void;
  readonly revertDisabled: boolean;
  readonly onRevert: () => void;
}) {
  const { copyToClipboard } = useCopyToClipboard<void>({
    onCopy: () => {
      toastManager.add({ type: "success", title: "Copied to clipboard" });
    },
    onError: (error: Error) => {
      toastManager.add(
        stackedThreadToast({
          type: "error",
          title: "Failed to copy",
          description: error.message,
        }),
      );
    },
  });

  return (
    <Sheet open={target !== null} onOpenChange={onOpenChange}>
      <SheetPopup side="bottom" aria-label="Message actions">
        <SheetHeader>
          <SheetTitle className="text-base">Message actions</SheetTitle>
          <SheetDescription className="sr-only">Actions for the selected message</SheetDescription>
        </SheetHeader>
        <SheetPanel className="pb-safe">
          <div role="group" aria-label="Message actions" className="space-y-0.5">
            {target?.copyText ? (
              <button
                type="button"
                className={ROW_CLASS_NAME}
                onClick={() => {
                  onOpenChange(false);
                  copyToClipboard(target.copyText ?? "");
                }}
              >
                <CopyIcon aria-hidden className="size-4 shrink-0" />
                {target.role === "assistant" ? "Copy response" : "Copy message"}
              </button>
            ) : null}
            {target?.role === "user" && target.canRevert ? (
              <button
                type="button"
                className={ROW_CLASS_NAME}
                disabled={revertDisabled}
                onClick={() => {
                  onOpenChange(false);
                  onRevert();
                }}
              >
                <Undo2Icon aria-hidden className="size-4 shrink-0" />
                Revert to this message
              </button>
            ) : null}
          </div>
        </SheetPanel>
      </SheetPopup>
    </Sheet>
  );
}
