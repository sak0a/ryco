import { deleteEnv } from "@ryco/shared/runtimeEnv";

const DESKTOP_OWNED_HUB_ENVIRONMENT = [
  "RYCO_HUB_CONNECTOR_ENABLED",
  "RYCO_HUB_ORIGIN",
  "RYCO_HUB_NODE_NAME",
  "RYCO_HUB_ALLOW_FILE_SECRET_STORE",
] as const;

export function removeDesktopOwnedHubEnvironment(env: NodeJS.ProcessEnv): void {
  for (const name of DESKTOP_OWNED_HUB_ENVIRONMENT) {
    deleteEnv(env, name);
  }
}
