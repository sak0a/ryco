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
