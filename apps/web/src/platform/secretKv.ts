import type { SecretKVService } from "@ryco/client-runtime/platform";
import type { EnvironmentId } from "@ryco/contracts";

import { ensureLocalApi } from "../localApi";

function environmentId(key: string): EnvironmentId {
  return key as EnvironmentId;
}

/**
 * Secrets must go through the LocalApi persistence facade: on desktop it
 * routes to the OS-secure bridge, in the browser to the expiry-bounded
 * localStorage store. Bypassing it would demote desktop tokens to
 * browser storage.
 */
export const webSecretKV: SecretKVService = {
  get: (key) => ensureLocalApi().persistence.getSavedEnvironmentSecret(environmentId(key)),
  set: (key, value) =>
    ensureLocalApi().persistence.setSavedEnvironmentSecret(environmentId(key), value),
  remove: (key) => ensureLocalApi().persistence.removeSavedEnvironmentSecret(environmentId(key)),
};
