import type { SecretKVService } from "@ryco/client-runtime/platform";
import type { EnvironmentId } from "@ryco/contracts";

import {
  readBrowserSavedEnvironmentSecret,
  removeBrowserSavedEnvironmentSecret,
  writeBrowserSavedEnvironmentSecret,
} from "../clientPersistenceStorage";

function environmentId(key: string): EnvironmentId {
  return key as EnvironmentId;
}

export const webSecretKV: SecretKVService = {
  get: async (key) => readBrowserSavedEnvironmentSecret(environmentId(key)),
  set: async (key, value) => {
    writeBrowserSavedEnvironmentSecret(environmentId(key), value);
  },
  remove: async (key) => {
    removeBrowserSavedEnvironmentSecret(environmentId(key));
  },
};
