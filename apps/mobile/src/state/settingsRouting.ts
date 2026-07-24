import { Struct } from "effect";

import {
  ServerSettings,
  type ClientSettingsPatch,
  type ServerSettingsPatch,
  type UnifiedSettings,
} from "@ryco/contracts/settings";

// §3-20 settings patch routing (pure). Splits a unified settings patch into the
// server-owned keys (dispatched over RPC + optimistically applied to the server
// config atom) and the client-owned keys (persisted device-locally to mobileKV).
// The split is the single source of truth used by the mobile settings hook — the
// server key set is derived from the contract, mirroring apps/web useSettings.ts.

const SERVER_SETTINGS_KEYS = new Set<string>(Struct.keys(ServerSettings.fields));

export function isServerSettingKey(key: string): boolean {
  return SERVER_SETTINGS_KEYS.has(key);
}

export function splitUnifiedSettingsPatch(patch: Partial<UnifiedSettings>): {
  readonly serverPatch: ServerSettingsPatch;
  readonly clientPatch: ClientSettingsPatch;
} {
  const serverPatch: Record<string, unknown> = {};
  const clientPatch: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(patch)) {
    if (SERVER_SETTINGS_KEYS.has(key)) {
      serverPatch[key] = value;
    } else {
      clientPatch[key] = value;
    }
  }
  return {
    serverPatch: serverPatch as ServerSettingsPatch,
    clientPatch: clientPatch as ClientSettingsPatch,
  };
}

export interface UpdateMobileSettingsDeps {
  /** Optimistically apply the server patch to the server-config atom. */
  readonly applyServerOptimistic: (serverPatch: ServerSettingsPatch) => void;
  /** Dispatch the server patch over RPC (client.server.updateSettings). */
  readonly updateServerSettings: (serverPatch: ServerSettingsPatch) => void | Promise<void>;
  /** Persist the client patch device-locally (mobileKV). */
  readonly persistClientSettings: (clientPatch: ClientSettingsPatch) => void;
}

export function updateMobileSettings(
  patch: Partial<UnifiedSettings>,
  deps: UpdateMobileSettingsDeps,
): void {
  const { serverPatch, clientPatch } = splitUnifiedSettingsPatch(patch);
  if (Object.keys(serverPatch).length > 0) {
    deps.applyServerOptimistic(serverPatch);
    void deps.updateServerSettings(serverPatch);
  }
  if (Object.keys(clientPatch).length > 0) {
    deps.persistClientSettings(clientPatch);
  }
}
