// ---------------------------------------------------------------------------
// Send-undo window
//
// A short "undo send" window sits between the user submitting a message and the
// turn being dispatched to the provider. The controller below is a tiny state
// machine that guarantees the outbound turn resolves exactly once — it either
// `commit`s (dispatch proceeds) or is `undo`ne (dispatch is skipped). Keeping the
// transitions free of timers/DOM makes the state machine unit-testable in
// isolation; `runSendUndoWindow` wires it to a timer + UI presenter.
// ---------------------------------------------------------------------------

export type SendUndoStatus = "armed" | "committed" | "undone";

export interface SendUndoController {
  readonly status: SendUndoStatus;
  /** Cancel the pending send. Returns true iff this call transitioned armed → undone. */
  undo(): boolean;
  /** Proceed with the pending send. Returns true iff this call transitioned armed → committed. */
  commit(): boolean;
}

/**
 * Create an armed send-undo controller. `onCommit` / `onUndo` fire at most once,
 * and never both — whichever of `commit()` / `undo()` wins first wins for good.
 */
export function createSendUndoController(handlers: {
  onCommit: () => void;
  onUndo: () => void;
}): SendUndoController {
  let status: SendUndoStatus = "armed";
  return {
    get status() {
      return status;
    },
    undo() {
      if (status !== "armed") return false;
      status = "undone";
      handlers.onUndo();
      return true;
    },
    commit() {
      if (status !== "armed") return false;
      status = "committed";
      handlers.onCommit();
      return true;
    },
  };
}

type TimerHandle = ReturnType<typeof setTimeout>;

export interface SendUndoWindowOptions {
  /** How long the undo affordance stays live before the send auto-commits. */
  windowMs: number;
  /**
   * Present the undo affordance. Receives a `triggerUndo` callback the UI wires to
   * its Undo control. Returns an optional disposer that is invoked exactly once when
   * the window resolves (either commit or undo) so the affordance can be torn down.
   */
  present: (controls: { triggerUndo: () => void }) => (() => void) | void;
  /** Injectable timer for tests; defaults to the global `setTimeout`. */
  setTimer?: (callback: () => void, ms: number) => TimerHandle;
  /** Injectable timer cleanup for tests; defaults to the global `clearTimeout`. */
  clearTimer?: (handle: TimerHandle) => void;
}

/**
 * Run a single send-undo window. Resolves with `"committed"` once the window
 * elapses (or the presenter is unused), or `"undone"` if the Undo control fires
 * first. The presenter's disposer runs before the promise resolves.
 */
export function runSendUndoWindow(options: SendUndoWindowOptions): Promise<SendUndoStatus> {
  const setTimer = options.setTimer ?? ((callback, ms) => setTimeout(callback, ms));
  const clearTimer = options.clearTimer ?? ((handle) => clearTimeout(handle));

  return new Promise<SendUndoStatus>((resolve) => {
    let dispose: (() => void) | void;
    let timer: TimerHandle | null = null;

    const settle = (status: SendUndoStatus) => {
      if (timer !== null) {
        clearTimer(timer);
        timer = null;
      }
      dispose?.();
      resolve(status);
    };

    const controller = createSendUndoController({
      onCommit: () => settle("committed"),
      onUndo: () => settle("undone"),
    });

    timer = setTimer(() => controller.commit(), options.windowMs);
    dispose = options.present({ triggerUndo: () => controller.undo() });
  });
}
