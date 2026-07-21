import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ContextMenuItem } from "@ryco/contracts";
import { ChevronLeftIcon, ChevronRightIcon } from "lucide-react";

import {
  getContextMenuSheetRequest,
  registerContextMenuSheetHost,
  settleContextMenuSheet,
  subscribeToContextMenuSheet,
  type ContextMenuSheetRequest,
} from "../../../contextMenuSheetState";
import { cn } from "~/lib/utils";
import {
  Sheet,
  SheetDescription,
  SheetHeader,
  SheetPanel,
  SheetPopup,
  SheetTitle,
} from "../../ui/sheet";

function getServerSnapshot(): ContextMenuSheetRequest | null {
  return null;
}

/**
 * The phone-tier presenter for `api.contextMenu.show(...)`: renders any
 * context-menu descriptor set as a bottom action sheet with touch-sized rows,
 * destructive styling, and drill-in submenus. Mounted once in the app shell;
 * renders nothing while no request is active. Desktop keeps the existing DOM
 * fallback and native menus untouched.
 */
export function ContextMenuActionSheetHost() {
  useEffect(() => registerContextMenuSheetHost(), []);
  const request = useSyncExternalStore(
    subscribeToContextMenuSheet,
    getContextMenuSheetRequest,
    getServerSnapshot,
  );
  // The last request is retained while the sheet animates closed so rows do
  // not vanish before the exit transition and focus restoration finish.
  const lastRequestRef = useRef<ContextMenuSheetRequest | null>(null);
  if (request !== null) {
    lastRequestRef.current = request;
  }
  const displayedRequest = request ?? lastRequestRef.current;

  if (displayedRequest === null) {
    return null;
  }

  return (
    <Sheet
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          settleContextMenuSheet(displayedRequest.id, null);
        }
      }}
    >
      <ContextMenuActionSheetContent key={displayedRequest.id} request={displayedRequest} />
    </Sheet>
  );
}

function ContextMenuActionSheetContent({ request }: { readonly request: ContextMenuSheetRequest }) {
  const [submenuStack, setSubmenuStack] = useState<
    ReadonlyArray<{
      readonly label: string;
      readonly items: readonly ContextMenuItem<string>[];
    }>
  >([]);
  const currentLevel = submenuStack.at(-1);
  const items = currentLevel?.items ?? request.items;

  // Drill-in focus: pushing or popping a submenu moves focus to the first
  // row of the new level (Back when inside a submenu) so keyboard and
  // screen-reader users land on the level they navigated to. The initial
  // level keeps base-ui's own initial focus.
  const rowsRef = useRef<HTMLDivElement | null>(null);
  const previousStackDepthRef = useRef(submenuStack.length);
  useEffect(() => {
    if (previousStackDepthRef.current === submenuStack.length) {
      return;
    }
    previousStackDepthRef.current = submenuStack.length;
    rowsRef.current?.querySelector<HTMLButtonElement>("button:not(:disabled)")?.focus();
  }, [submenuStack.length]);

  return (
    <SheetPopup side="bottom" aria-label="Actions">
      <SheetHeader>
        <SheetTitle className="truncate text-base">{currentLevel?.label ?? "Actions"}</SheetTitle>
        <SheetDescription className="sr-only">Context actions</SheetDescription>
      </SheetHeader>
      <SheetPanel className="pb-safe">
        <div ref={rowsRef} role="group" aria-label="Context actions" className="space-y-0.5">
          {currentLevel ? (
            <button
              type="button"
              className="flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm text-muted-foreground hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              onClick={() => setSubmenuStack((stack) => stack.slice(0, -1))}
            >
              <ChevronLeftIcon aria-hidden className="size-4 shrink-0" />
              Back
            </button>
          ) : null}
          {items.map((item) => {
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            // Destructive parity with the DOM fallback: explicit flag or the
            // conventional "delete" leaf id.
            const isDestructive =
              !hasChildren && (item.destructive === true || item.id === "delete");
            return (
              <button
                key={item.id}
                type="button"
                disabled={item.disabled === true}
                className={cn(
                  "flex min-h-11 w-full items-center gap-2 rounded-md px-2 text-left text-sm hover:bg-accent focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:text-muted-foreground/60",
                  isDestructive && "text-destructive",
                )}
                onClick={() => {
                  if (hasChildren) {
                    setSubmenuStack((stack) => [
                      ...stack,
                      { label: item.label, items: item.children! },
                    ]);
                    return;
                  }
                  settleContextMenuSheet(request.id, item.id);
                }}
              >
                <span className="min-w-0 flex-1 truncate">{item.label}</span>
                {hasChildren ? (
                  <ChevronRightIcon
                    aria-hidden
                    className="size-4 shrink-0 text-muted-foreground/70"
                  />
                ) : null}
              </button>
            );
          })}
        </div>
      </SheetPanel>
    </SheetPopup>
  );
}
