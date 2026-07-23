import type { ClientRuntimeConfigService } from "@ryco/client-runtime/platform";

import { readRycoClientMode } from "../env";

function envValue(name: keyof ImportMetaEnv): string | undefined {
  const value = import.meta.env[name]?.trim();
  return value ? value : undefined;
}

export function readWebClientRuntimeConfig(): ClientRuntimeConfigService {
  const httpBaseUrl = envValue("VITE_HTTP_URL");
  const wsBaseUrl = envValue("VITE_WS_URL");
  const hostedAppUrl = envValue("VITE_HOSTED_APP_URL");
  const devServerUrl = envValue("VITE_DEV_SERVER_URL");
  const perfProfile = envValue("VITE_RYCO_PERF_PROFILE");
  return {
    clientMode: readRycoClientMode(),
    ...(httpBaseUrl === undefined ? {} : { httpBaseUrl }),
    ...(wsBaseUrl === undefined ? {} : { wsBaseUrl }),
    ...(hostedAppUrl === undefined ? {} : { hostedAppUrl }),
    ...(devServerUrl === undefined ? {} : { devServerUrl }),
    ...(perfProfile === undefined ? {} : { perfProfile }),
  };
}
