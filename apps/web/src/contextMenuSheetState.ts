import type { ContextMenuItem } from "@ryco/contracts";

/**
 * Shared state for the phone-tier context-menu action sheet.
 *
 * `localApi.contextMenu.show(...)` routes here on the phone tier instead of
 * the mouse-only DOM context-menu fallback. The React host
 * (`ContextMenuActionSheetHost`) renders the active request as a bottom
 * action sheet and settles the promise with the tapped leaf id (or null on
 * dismissal). The module is deliberately React-free so `localApi` never
 * imports component code.
 */

export interface ContextMenuSheetRequest {
  readonly id: number;
  readonly items: readonly ContextMenuItem<string>[];
}

interface ActiveContextMenuSheetRequest extends ContextMenuSheetRequest {
  readonly resolve: (clicked: string | null) => void;
}

let hostCount = 0;
let requestSequence = 0;
let activeRequest: ActiveContextMenuSheetRequest | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) {
    listener();
  }
}

/** True while at least one `ContextMenuActionSheetHost` is mounted. */
export function isContextMenuSheetHostMounted(): boolean {
  return hostCount > 0;
}

/** Host lifecycle registration; returns the unregister cleanup. */
export function registerContextMenuSheetHost(): () => void {
  hostCount += 1;
  return () => {
    hostCount -= 1;
    if (hostCount === 0 && activeRequest) {
      settleContextMenuSheet(activeRequest.id, null);
    }
  };
}

export function subscribeToContextMenuSheet(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function getContextMenuSheetRequest(): ContextMenuSheetRequest | null {
  return activeRequest;
}

/**
 * Presents a context-menu descriptor set as a bottom action sheet and
 * resolves with the tapped leaf id, or null when dismissed. A newer request
 * supersedes an unsettled older one (the older promise resolves null),
 * matching the DOM fallback's single-menu behavior.
 */
export function presentContextMenuSheet<T extends string>(
  items: readonly ContextMenuItem<T>[],
): Promise<T | null> {
  return new Promise<T | null>((resolve) => {
    activeRequest?.resolve(null);
    requestSequence += 1;
    activeRequest = {
      id: requestSequence,
      items: items as readonly ContextMenuItem<string>[],
      resolve: resolve as (clicked: string | null) => void,
    };
    emit();
  });
}

/** Settles the request with the tapped leaf id (or null on dismissal). */
export function settleContextMenuSheet(requestId: number, clicked: string | null): void {
  if (!activeRequest || activeRequest.id !== requestId) {
    return;
  }
  const settled = activeRequest;
  activeRequest = null;
  emit();
  settled.resolve(clicked);
}

export function __resetContextMenuSheetForTests(): void {
  activeRequest?.resolve(null);
  activeRequest = null;
  emit();
}
