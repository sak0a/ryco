import type { ReactNode } from "react";
import type { ScopedThreadRef } from "@ryco/contracts";
import { parseScopedThreadKey } from "@ryco/client-runtime/scoped";

import { Button } from "../../ui/button";
import {
  Dialog,
  DialogFooter,
  DialogHeader,
  DialogPanel,
  DialogPopup,
  DialogTitle,
} from "../../ui/dialog";
import { MobileListRow } from "../../mobile/MobileListRow";
import {
  MobileSheet,
  MobileSheetDescription,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
} from "../../mobile/MobileSheet";
import type {
  ThreadMenuActionId,
  ThreadMenuActionItem,
} from "../../sidebar/hooks/useSidebarThreadActions";

/**
 * The phone bottom-sheet presenter for the shared thread action inventory.
 * Items and handlers come from `useSidebarThreadActions` — the same inventory
 * the desktop DOM context menu shows — so the two presenters can never
 * diverge. `leadingSections` lets the thread app bar prepend surface-specific
 * entries (find-in-thread, the session tab list).
 */
export function PhoneThreadActionsSheet({
  open,
  onOpenChange,
  title,
  items,
  onAction,
  leadingSections,
}: {
  readonly open: boolean;
  readonly onOpenChange: (open: boolean) => void;
  readonly title: string;
  readonly items: ReadonlyArray<ThreadMenuActionItem>;
  readonly onAction: (actionId: ThreadMenuActionId) => void;
  readonly leadingSections?: ReactNode;
}) {
  return (
    <MobileSheet open={open} onOpenChange={onOpenChange} label="Thread actions">
      <MobileSheetHeader>
        <MobileSheetTitle>{title}</MobileSheetTitle>
        <MobileSheetDescription className="sr-only">Thread actions</MobileSheetDescription>
      </MobileSheetHeader>
      <MobileSheetPanel>
        {leadingSections}
        <div role="group" aria-label="Thread actions" className="space-y-0.5">
          {items.map((item) => (
            <MobileListRow
              key={item.id}
              label={item.label}
              destructive={item.destructive === true}
              onClick={() => {
                onOpenChange(false);
                onAction(item.id);
              }}
            />
          ))}
        </div>
      </MobileSheetPanel>
    </MobileSheet>
  );
}

/**
 * Touch-friendly rename presenter for the shared rename flow: the desktop
 * sidebar renames inline in its rows; phone surfaces open this dialog around
 * the same `commitRename` / `cancelRename` handlers.
 */
export function PhoneThreadRenameDialog({
  renamingThreadKey,
  originalTitle,
  renamingTitle,
  setRenamingTitle,
  commitRename,
  cancelRename,
}: {
  readonly renamingThreadKey: string | null;
  readonly originalTitle: string;
  readonly renamingTitle: string;
  readonly setRenamingTitle: (title: string) => void;
  readonly commitRename: (
    threadRef: ScopedThreadRef,
    newTitle: string,
    originalTitle: string,
  ) => Promise<void>;
  readonly cancelRename: () => void;
}) {
  const threadRef = renamingThreadKey ? parseScopedThreadKey(renamingThreadKey) : null;
  if (!threadRef) return null;

  const submit = () => {
    void commitRename(threadRef, renamingTitle, originalTitle);
  };

  return (
    <Dialog
      open
      onOpenChange={(nextOpen) => {
        if (!nextOpen) cancelRename();
      }}
    >
      <DialogPopup>
        <DialogHeader>
          <DialogTitle>Rename thread</DialogTitle>
        </DialogHeader>
        <DialogPanel>
          <label htmlFor="phone-thread-rename-title" className="sr-only">
            Thread title
          </label>
          <input
            id="phone-thread-rename-title"
            autoFocus
            value={renamingTitle}
            maxLength={500}
            onChange={(event) => setRenamingTitle(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            className="h-11 w-full rounded-lg border border-input bg-background px-3 text-base outline-none focus-visible:ring-2 focus-visible:ring-ring"
          />
        </DialogPanel>
        <DialogFooter>
          <Button variant="outline" className="phone:min-h-11" onClick={cancelRename}>
            Cancel
          </Button>
          <Button className="phone:min-h-11" onClick={submit}>
            Rename
          </Button>
        </DialogFooter>
      </DialogPopup>
    </Dialog>
  );
}
