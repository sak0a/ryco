let available = false;
const listeners = new Set<() => void>();

/** Side-effect-free hosted availability projection for screens and state bindings. */
export function isMobileHostedModeAvailable(): boolean {
  return available;
}

export function subscribeMobileHostedModeAvailability(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Runtime-owned writer; kept separate so importing screen state loads no native adapter. */
export function setMobileHostedModeAvailable(next: boolean): void {
  if (available === next) return;
  available = next;
  for (const listener of listeners) listener();
}
