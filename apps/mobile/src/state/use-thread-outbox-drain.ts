// B2 mount point for the offline outbox drain. The real persistent-outbox drain
// (§3-14) lands with the Thread-detail/send task; until then this is a bound
// no-op so RootStackLayout can mount it without an import-time side effect.
export function useThreadOutboxDrain(): void {
  // intentionally empty until the send pipeline + persistent outbox land
}
