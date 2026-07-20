import { cdp } from "vite-plus/test/browser";

// The published CDPSession type is an empty interface; the playwright
// provider's session exposes `send` at runtime.
interface CdpInputSession {
  send: (method: string, params?: Record<string, unknown>) => Promise<unknown>;
}

export function cdpSession(): CdpInputSession {
  return cdp() as unknown as CdpInputSession;
}

/**
 * Emulates (or reverts) a touch primary pointer so `pointer-coarse:` styles
 * and `(pointer: coarse)` media queries apply. Callers must revert before the
 * test ends so later tests keep the fine-pointer default.
 */
export async function setCoarsePointerEmulation(enabled: boolean): Promise<void> {
  await cdpSession().send("Emulation.setTouchEmulationEnabled", {
    enabled,
    ...(enabled ? { maxTouchPoints: 1 } : {}),
  });
}

/**
 * Moves the real input pointer to fixed page coordinates. The browser suite
 * shares one pointer across test files, so parking it deterministically
 * protects hover-sensitive assertions from wherever an earlier file left it.
 */
export async function parkPointer(x: number, y: number): Promise<void> {
  await cdpSession().send("Input.dispatchMouseEvent", { type: "mouseMoved", x, y });
}

/**
 * Defensive per-test reset: reverts any touch emulation left by an earlier
 * test or file and waits until `(pointer: coarse)` no longer matches. Note
 * that disabling touch emulation restores the PLATFORM capabilities: Linux
 * headless CI has no input devices and then reports `pointer: none` and
 * `hover: none`, so callers must not assume a hover-capable pointer here —
 * gate hover-media-dependent assertions on `(hover: hover)` instead.
 */
export async function resetPointerEmulation(): Promise<void> {
  // Only revert an actual coarse leak: the disable itself recomputes the
  // capabilities from the platform, which would needlessly downgrade pristine
  // pages on device-less CI runners.
  if (!window.matchMedia("(pointer: coarse)").matches) {
    return;
  }
  await setCoarsePointerEmulation(false);
  const deadline = Date.now() + 10_000;
  while (window.matchMedia("(pointer: coarse)").matches) {
    if (Date.now() > deadline) {
      throw new Error("Timed out waiting for the coarse-pointer emulation to revert.");
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
}
