import type { ServerConfig, ServerConfigStreamEvent } from "@ryco/contracts";

/**
 * Project one server-config stream event onto an environment-local snapshot.
 * Incremental events are intentionally ignored until that stream has supplied
 * an authoritative snapshot for its current connection generation.
 */
export function projectServerConfigEvent(
  current: ServerConfig | null,
  event: ServerConfigStreamEvent,
): ServerConfig | null {
  switch (event.type) {
    case "snapshot":
      return event.config;
    case "keybindingsUpdated":
      return current
        ? {
            ...current,
            keybindings: event.payload.keybindings,
            issues: event.payload.issues,
          }
        : null;
    case "providerStatuses":
      return current ? { ...current, providers: event.payload.providers } : null;
    case "settingsUpdated":
      return current ? { ...current, settings: event.payload.settings } : null;
  }
}
