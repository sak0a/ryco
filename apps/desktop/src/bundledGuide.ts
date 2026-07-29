import * as Path from "node:path";
import { fileURLToPath } from "node:url";

const RELAY_GUIDE_FILE = /^relay-architecture(?:-[A-Za-z0-9_-]+)?\.html$/;

/**
 * Resolve the one HTML asset the renderer may ask the operating system to open.
 *
 * General external links remain HTTP(S)-only. This exception is deliberately
 * constrained to a Vite-emitted relay guide below the loaded app directory, so
 * a compromised renderer cannot turn the external-link bridge into a local file
 * opener.
 */
export function resolveBundledRelayGuidePath(
  rawTargetUrl: unknown,
  rawSourceUrl: unknown,
): string | null {
  if (typeof rawTargetUrl !== "string" || typeof rawSourceUrl !== "string") {
    return null;
  }

  try {
    const targetUrl = new URL(rawTargetUrl);
    const sourceUrl = new URL(rawSourceUrl);
    if (
      targetUrl.protocol !== "file:" ||
      sourceUrl.protocol !== "file:" ||
      targetUrl.search !== "" ||
      targetUrl.hash !== ""
    ) {
      return null;
    }

    const targetPath = Path.resolve(fileURLToPath(targetUrl));
    const sourceDirectory = Path.dirname(Path.resolve(fileURLToPath(sourceUrl)));
    const relativePath = Path.relative(sourceDirectory, targetPath);
    if (
      relativePath === "" ||
      relativePath.startsWith(`..${Path.sep}`) ||
      relativePath === ".." ||
      Path.isAbsolute(relativePath) ||
      !RELAY_GUIDE_FILE.test(Path.basename(targetPath))
    ) {
      return null;
    }

    return targetPath;
  } catch {
    return null;
  }
}
