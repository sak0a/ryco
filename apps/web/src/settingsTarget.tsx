import type { EnvironmentId, ServerConfig } from "@ryco/contracts";
import { createContext, useContext, type ReactNode } from "react";

/**
 * The exact node whose settings are displayed by the open settings surface.
 *
 * Most of the application intentionally reads the primary server snapshot. A
 * settings dialog is different: Desktop can open a remote Hub node without
 * replacing its colocated primary backend, so node-owned reads and writes must
 * carry the selected environment explicitly instead of falling back to that
 * primary connection.
 */
export interface SettingsTarget {
  readonly environmentId: EnvironmentId;
  readonly nodeLabel: string;
  readonly serverConfig: ServerConfig | null;
  readonly primary: boolean;
  readonly connected: boolean;
}

export function resolveSettingsTargetEnvironmentId(input: {
  readonly requestedEnvironmentId: EnvironmentId | null;
  readonly routedEnvironmentId: EnvironmentId | null;
  readonly activeEnvironmentId: EnvironmentId | null;
  readonly primaryEnvironmentId: EnvironmentId | null;
}): EnvironmentId | null {
  return (
    input.requestedEnvironmentId ??
    input.routedEnvironmentId ??
    input.activeEnvironmentId ??
    input.primaryEnvironmentId ??
    null
  );
}

const SettingsTargetContext = createContext<SettingsTarget | null>(null);

export function SettingsTargetProvider(props: {
  readonly value: SettingsTarget | null;
  readonly children: ReactNode;
}) {
  return (
    <SettingsTargetContext.Provider value={props.value}>
      {props.children}
    </SettingsTargetContext.Provider>
  );
}

export function useSettingsTarget(): SettingsTarget | null {
  return useContext(SettingsTargetContext);
}
