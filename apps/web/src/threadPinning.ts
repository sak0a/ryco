import { readLocalApi } from "./localApi";
import { useUiStateStore } from "./uiStateStore";

export type ThreadPinChangeResult = "changed" | "unchanged" | "cancelled";

export interface ThreadPinCommandPresentation {
  readonly disabled: boolean;
  readonly pinned: boolean;
  readonly title: string;
  readonly description: string | undefined;
}

export function resolveThreadPinCommandPresentation(input: {
  readonly threadKey: string | null;
  readonly pinned: boolean;
}): ThreadPinCommandPresentation {
  if (!input.threadKey) {
    return {
      disabled: true,
      pinned: false,
      title: "Pin current thread",
      description: "Open a thread to pin or unpin it.",
    };
  }
  return {
    disabled: false,
    pinned: input.pinned,
    title: input.pinned ? "Unpin current thread" : "Pin current thread",
    description: undefined,
  };
}

interface ThreadPinDependencies {
  readonly isPinned: (threadKey: string) => boolean;
  readonly setPinned: (threadKey: string, pinned: boolean) => void;
  readonly confirm: (message: string) => Promise<boolean>;
}

const defaultDependencies: ThreadPinDependencies = {
  isPinned: (threadKey) => useUiStateStore.getState().pinnedThreadKeys[threadKey] === true,
  setPinned: (threadKey, pinned) => useUiStateStore.getState().setThreadPinned(threadKey, pinned),
  confirm: async (message) => {
    const localApi = readLocalApi();
    return localApi ? localApi.dialogs.confirm(message) : window.confirm(message);
  },
};

export async function requestThreadPinChange(
  input: {
    readonly threadKey: string;
    readonly threadTitle: string;
    readonly pinned: boolean;
    readonly confirmUnpin: boolean;
  },
  dependencies: ThreadPinDependencies = defaultDependencies,
): Promise<ThreadPinChangeResult> {
  if (dependencies.isPinned(input.threadKey) === input.pinned) {
    return "unchanged";
  }
  if (
    !input.pinned &&
    input.confirmUnpin &&
    !(await dependencies.confirm(
      `Unpin "${input.threadTitle}"?\nIt will return to its normal position in the thread list.`,
    ))
  ) {
    return "cancelled";
  }
  dependencies.setPinned(input.threadKey, input.pinned);
  return "changed";
}

export function toggleThreadPin(
  input: {
    readonly threadKey: string;
    readonly threadTitle: string;
    readonly confirmUnpin: boolean;
  },
  dependencies: ThreadPinDependencies = defaultDependencies,
): Promise<ThreadPinChangeResult> {
  return requestThreadPinChange(
    {
      ...input,
      pinned: !dependencies.isPinned(input.threadKey),
    },
    dependencies,
  );
}
