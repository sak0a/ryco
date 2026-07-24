import type { ClientRuntimeConfigService } from "@ryco/client-runtime/platform";
import Constants from "expo-constants";

interface MobileExtraConfig {
  readonly node?: {
    readonly httpBaseUrl?: string | null;
    readonly wsBaseUrl?: string | null;
  };
}

function readExtra(): MobileExtraConfig {
  return (Constants.expoConfig?.extra as MobileExtraConfig | undefined) ?? {};
}

function trimmed(value: string | null | undefined): string | undefined {
  const next = value?.trim();
  return next ? next : undefined;
}

/**
 * The RN analogue of the web `readWebClientRuntimeConfig`: replaces ambient
 * `import.meta.env` reads with the app config's `extra`. Hosted mode is inert in
 * B1, so the client mode is always "standard"; an optional default node origin
 * supports local testing before pairing.
 */
export function readMobileClientRuntimeConfig(): ClientRuntimeConfigService {
  const extra = readExtra();
  const httpBaseUrl = trimmed(extra.node?.httpBaseUrl);
  const wsBaseUrl = trimmed(extra.node?.wsBaseUrl);
  return {
    clientMode: "standard",
    ...(httpBaseUrl === undefined ? {} : { httpBaseUrl }),
    ...(wsBaseUrl === undefined ? {} : { wsBaseUrl }),
  };
}
