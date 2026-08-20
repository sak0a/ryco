import type { HostedHubState } from "@ryco/client-runtime/authorization";
import type { KVService } from "@ryco/client-runtime/platform";

/**
 * Persist the selected Hub node so it survives an app relaunch (wave 2
 * amendment A — selection previously lived only in the in-memory hosted
 * store). The selection is restored at most once per launch, and only through
 * the controller's own `selectNode` guard path, so a persisted node that has
 * been revoked or removed can never be re-selected — its record is cleared
 * instead.
 */
export const HUB_SELECTED_NODE_STORAGE_KEY = "ryco.hostedHub.selectedNode.v1";

export interface PersistedHubSelection {
  readonly nodeId: string;
  readonly environmentId: string;
}

export function serializePersistedHubSelection(selection: PersistedHubSelection): string {
  return JSON.stringify({
    version: 1,
    nodeId: selection.nodeId,
    environmentId: selection.environmentId,
  });
}

export function deserializePersistedHubSelection(raw: string): PersistedHubSelection | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const candidate = value as Record<string, unknown>;
  if (candidate.version !== 1) return null;
  if (typeof candidate.nodeId !== "string" || candidate.nodeId.length === 0) return null;
  if (typeof candidate.environmentId !== "string" || candidate.environmentId.length === 0) {
    return null;
  }
  return { nodeId: candidate.nodeId, environmentId: candidate.environmentId };
}

export type HubSelectionRestoreDecision =
  | { readonly kind: "wait" }
  | { readonly kind: "select"; readonly nodeId: string }
  | { readonly kind: "clear" };

type RestoreStateInput = Pick<
  HostedHubState,
  "accountStatus" | "directoryStatus" | "browserStatus" | "selectedNode" | "nodes"
>;

/**
 * Decide what to do with a persisted selection given the current hosted
 * state. "wait" until the directory is authoritative; then either re-select
 * the persisted node or clear a record that no longer maps to a selectable
 * node. Matched on (id, environmentId) like the runtime's own selection
 * refresh.
 */
export function deriveHubSelectionRestore(
  state: RestoreStateInput,
  persisted: PersistedHubSelection,
): HubSelectionRestoreDecision {
  if (state.selectedNode) return { kind: "clear" };
  if (
    state.accountStatus !== "authenticated" ||
    state.directoryStatus !== "ready" ||
    state.browserStatus !== "current"
  ) {
    return { kind: "wait" };
  }
  const node = state.nodes.find(
    (candidate) =>
      candidate.id === persisted.nodeId && candidate.environmentId === persisted.environmentId,
  );
  if (!node || node.revokedAt !== null) return { kind: "clear" };
  return { kind: "select", nodeId: node.id };
}

interface HostedStoreLike {
  readonly getState: () => HostedHubState;
  readonly subscribe: (listener: () => void) => () => void;
}

/**
 * Wire selection persistence to the hosted store: every selection change is
 * written through (deselection clears the record — deliberate deselection,
 * sign-out, and revocation all end with a null selection and none of them
 * should be resurrected), and one restore attempt runs once the directory is
 * ready. Returns an uninstaller.
 */
export function installHubSelectionPersistence(deps: {
  readonly kv: Pick<KVService, "getItem" | "setItem" | "removeItem">;
  readonly store: HostedStoreLike;
  readonly selectNode: (nodeId: string) => Promise<void>;
}): () => void {
  let previousSelectedNodeId: string | null = deps.store.getState().selectedNode?.id ?? null;
  let restoreSettled = previousSelectedNodeId !== null;
  let persisted: PersistedHubSelection | null = null;
  let hydrated = false;
  let uninstalled = false;

  const persistSelection = (selection: PersistedHubSelection | null) => {
    persisted = selection;
    if (selection) {
      void deps.kv
        .setItem(HUB_SELECTED_NODE_STORAGE_KEY, serializePersistedHubSelection(selection))
        .catch(() => undefined);
    } else {
      void deps.kv.removeItem(HUB_SELECTED_NODE_STORAGE_KEY).catch(() => undefined);
    }
  };

  const evaluate = () => {
    if (uninstalled) return;
    const state = deps.store.getState();

    const selectedNodeId = state.selectedNode?.id ?? null;
    if (selectedNodeId !== previousSelectedNodeId) {
      previousSelectedNodeId = selectedNodeId;
      // Any observed selection change settles the restore: the user (or the
      // runtime) has made a decision this launch and it wins over the record.
      restoreSettled = true;
      persistSelection(
        state.selectedNode
          ? {
              nodeId: state.selectedNode.id,
              environmentId: state.selectedNode.environmentId,
            }
          : null,
      );
      return;
    }

    if (restoreSettled || !hydrated || !persisted) return;
    const decision = deriveHubSelectionRestore(state, persisted);
    if (decision.kind === "wait") return;
    restoreSettled = true;
    if (decision.kind === "select") {
      void deps.selectNode(decision.nodeId).catch(() => undefined);
    } else {
      persistSelection(null);
    }
  };

  const unsubscribe = deps.store.subscribe(evaluate);
  void deps.kv
    .getItem(HUB_SELECTED_NODE_STORAGE_KEY)
    .catch(() => null)
    .then((raw) => {
      if (uninstalled) return;
      persisted = raw === null ? null : deserializePersistedHubSelection(raw);
      hydrated = true;
      evaluate();
    });

  return () => {
    uninstalled = true;
    unsubscribe();
  };
}
