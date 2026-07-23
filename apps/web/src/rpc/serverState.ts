import { useAtomSubscribe, useAtomValue } from "@effect/atom-react";
import type { Atom } from "effect/unstable/reactivity";
import {
  selectAvailableEditors,
  selectKeybindings,
  selectKeybindingsConfigPath,
  selectObservability,
  selectProviders,
  selectSettings,
  serverConfigAtom,
  serverConfigUpdatedAtom,
  welcomeAtom,
  type ServerConfigUpdatedNotification,
} from "@ryco/client-runtime/rpc";
import type {
  EditorId,
  ServerConfig,
  ServerLifecycleWelcomePayload,
  ServerProvider,
  ServerSettings,
} from "@ryco/contracts";
import { useCallback, useRef } from "react";

export * from "@ryco/client-runtime/rpc";

function useLatestAtomSubscription<A>(
  atom: Atom.Atom<A | null>,
  listener: (value: NonNullable<A>) => void,
): void {
  const listenerRef = useRef(listener);
  listenerRef.current = listener;

  const stableListener = useCallback((value: A | null) => {
    if (value === null) {
      return;
    }
    listenerRef.current(value as NonNullable<A>);
  }, []);

  useAtomSubscribe(atom, stableListener, { immediate: true });
}

export function useServerConfig(): ServerConfig | null {
  return useAtomValue(serverConfigAtom);
}

export function useServerSettings(): ServerSettings {
  return useAtomValue(serverConfigAtom, selectSettings);
}

export function useServerProviders(): ReadonlyArray<ServerProvider> {
  return useAtomValue(serverConfigAtom, selectProviders);
}

export function useServerKeybindings(): ServerConfig["keybindings"] {
  return useAtomValue(serverConfigAtom, selectKeybindings);
}

export function useServerAvailableEditors(): ReadonlyArray<EditorId> {
  return useAtomValue(serverConfigAtom, selectAvailableEditors);
}

export function useServerKeybindingsConfigPath(): string | null {
  return useAtomValue(serverConfigAtom, selectKeybindingsConfigPath);
}

export function useServerObservability(): ServerConfig["observability"] | null {
  return useAtomValue(serverConfigAtom, selectObservability);
}

export function useServerWelcomeSubscription(
  listener: (payload: ServerLifecycleWelcomePayload) => void,
): void {
  useLatestAtomSubscription(welcomeAtom, listener);
}

export function useServerConfigUpdatedSubscription(
  listener: (notification: ServerConfigUpdatedNotification) => void,
): void {
  useLatestAtomSubscription(serverConfigUpdatedAtom, listener);
}
