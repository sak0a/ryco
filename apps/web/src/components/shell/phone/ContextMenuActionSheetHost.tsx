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
import { MobileListRow } from "../../mobile/MobileListRow";
import {
  MobileSheet,
  MobileSheetDescription,
  MobileSheetHeader,
  MobileSheetPanel,
  MobileSheetTitle,
} from "../../mobile/MobileSheet";

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
    <MobileSheet
      open={request !== null}
      onOpenChange={(open) => {
        if (!open) {
          settleContextMenuSheet(displayedRequest.id, null);
        }
      }}
      label="Actions"
    >
      <ContextMenuActionSheetContent key={displayedRequest.id} request={displayedRequest} />
    </MobileSheet>
  );
}

/**
 * Submenu presentation decision: drill-in stays an **in-sheet view stack**, not
 * a stack of real sheets. One `api.contextMenu.show(...)` request has exactly
 * one settlement, and a nested `MobileSheet` would introduce a second modal
 * whose own dismissal (Escape, backdrop, swipe) would have to be reconciled
 * with that single resolution. Swapping the rows inside one sheet keeps
 * dismissal, focus restoration, and settlement in one place; the level change
 * is announced by moving focus to the new level's first row.
 */
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
    <>
      <MobileSheetHeader>
        <MobileSheetTitle>{currentLevel?.label ?? "Actions"}</MobileSheetTitle>
        <MobileSheetDescription className="sr-only">Context actions</MobileSheetDescription>
      </MobileSheetHeader>
      <MobileSheetPanel>
        <div ref={rowsRef} role="group" aria-label="Context actions" className="space-y-0.5">
          {currentLevel ? (
            <MobileListRow
              label="Back"
              className="text-muted-foreground"
              icon={<ChevronLeftIcon aria-hidden className="size-4 shrink-0" />}
              onClick={() => setSubmenuStack((stack) => stack.slice(0, -1))}
            />
          ) : null}
          {items.map((item) => {
            const hasChildren = Array.isArray(item.children) && item.children.length > 0;
            // Destructive parity with the DOM fallback: explicit flag or the
            // conventional "delete" leaf id.
            const isDestructive =
              !hasChildren && (item.destructive === true || item.id === "delete");
            return (
              <MobileListRow
                key={item.id}
                label={item.label}
                disabled={item.disabled === true}
                destructive={isDestructive}
                trailing={
                  hasChildren ? (
                    <ChevronRightIcon
                      aria-hidden
                      className="size-4 shrink-0 text-muted-foreground/70"
                    />
                  ) : undefined
                }
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
              />
            );
          })}
        </div>
      </MobileSheetPanel>
    </>
  );
}
