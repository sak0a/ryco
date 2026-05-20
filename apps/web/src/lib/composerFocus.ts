/**
 * Returns true when the chat composer (the main message input) currently has
 * focus. Used as a `when`-clause condition for keybindings so shortcuts can be
 * scoped to "while typing in the composer" vs "anywhere else".
 *
 * Matches the same approach as `isTerminalFocused`: we inspect the active
 * element's DOM ancestry rather than wiring a separate focus tracker.
 */
export function isComposerFocused(): boolean {
  const activeElement = document.activeElement;
  if (!(activeElement instanceof HTMLElement)) return false;
  if (!activeElement.isConnected) return false;
  return activeElement.closest('[data-testid="composer-editor"]') !== null;
}
