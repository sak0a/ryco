import { create } from "zustand";

/**
 * Which surface owns the one-time recovery-code display.
 *
 * `hostedHubStore.recoveryCodes` is a single in-memory slot, and two surfaces
 * legitimately want to render it. The hosted root shows the full-screen
 * "save your recovery codes" step that follows bootstrap and invitation
 * redemption — there is no app shell yet at that point, so it must take over the
 * viewport. Account settings regenerates them from inside the running app, where
 * the same takeover would tear the settings surface down mid-flow and lose the
 * user's place.
 *
 * A claim resolves that without either surface guessing about the other: while
 * a claim is held the root leaves the slot alone and the claimant renders it.
 * The count (rather than a flag) makes the claim safe under a remount that
 * mounts the replacement before unmounting the original.
 *
 * This says nothing about *clearing* the codes — that stays
 * `hostedHubController.dismissRecoveryCodes()`, and a claimant is still
 * responsible for calling it when its display goes away.
 */
interface RecoveryCodeDisplayStore {
  readonly claims: number;
  readonly claim: () => void;
  readonly release: () => void;
}

export const useRecoveryCodeDisplayStore = create<RecoveryCodeDisplayStore>((set) => ({
  claims: 0,
  claim: () => set((state) => ({ claims: state.claims + 1 })),
  release: () => set((state) => ({ claims: Math.max(0, state.claims - 1) })),
}));

/** True while another surface has taken responsibility for the display. */
export function isRecoveryCodeDisplayClaimed(): boolean {
  return useRecoveryCodeDisplayStore.getState().claims > 0;
}
