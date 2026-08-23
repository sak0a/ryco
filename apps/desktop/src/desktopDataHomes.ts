import * as Path from "node:path";

export function resolveDesktopDataHomes(input: {
  readonly configuredBaseDir: string | undefined;
  readonly defaultBaseDir: string;
  readonly isDevelopment: boolean;
}): {
  readonly backendBaseDir: string;
  readonly desktopBaseDir: string;
} {
  const backendBaseDir = input.configuredBaseDir?.trim() || input.defaultBaseDir;
  return {
    backendBaseDir,
    // Development needs a separate shell/native-security profile, but the
    // backend must keep using RYCO_HOME so its existing `dev/` project catalog
    // remains visible. The server adds that `dev/` segment itself.
    desktopBaseDir: input.isDevelopment ? Path.join(backendBaseDir, "desktop-dev") : backendBaseDir,
  };
}
