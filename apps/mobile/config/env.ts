// Local mobile config/env loader. Replaces the repo-root
// `scripts/lib/{brand-assets,public-config}` imports the upstream scaffold
// relied on: those carried the upstream vendor's proprietary brand assets and
// the hosted-auth/managed-cloud/telemetry env namespaces, none of which belong
// in the Ryco public scaffold.
//
// Reads optional `.env` / `.env.local` from the monorepo root before an Effect
// runtime exists (build bootstrap), and exposes only the bounded set of
// public env the Ryco mobile app config needs.
//
// @effect-diagnostics nodeBuiltinImport:off - build bootstrap runs before Effect.
import * as NodeFS from "node:fs";
import * as NodePath from "node:path";
import * as NodeURL from "node:url";
import * as NodeUtil from "node:util";

export type AppVariant = "development" | "preview" | "production";

export function resolveMobileRepoRoot(moduleUrl: string): string {
  return NodePath.dirname(
    NodePath.dirname(NodePath.dirname(NodePath.dirname(NodeURL.fileURLToPath(moduleUrl)))),
  );
}

const REPO_ROOT = resolveMobileRepoRoot(import.meta.url);

type Environment = Readonly<Record<string, string | undefined>>;

function readEnvFile(path: string): Record<string, string | undefined> {
  return NodeFS.existsSync(path) ? NodeUtil.parseEnv(NodeFS.readFileSync(path, "utf8")) : {};
}

/**
 * Merge the repo-root env files under the ambient process env. Later sources
 * win, matching the layered-env convention (process env overrides files).
 */
export function loadMobileEnv({
  baseEnv = process.env,
  repoRoot = REPO_ROOT,
}: {
  readonly baseEnv?: Environment;
  readonly repoRoot?: string;
} = {}): Record<string, string | undefined> {
  const rootEnv = readEnvFile(NodePath.join(repoRoot, ".env"));
  const localEnv = readEnvFile(NodePath.join(repoRoot, ".env.local"));
  return { ...rootEnv, ...localEnv, ...baseEnv };
}

export function resolveAppVariant(value: string | undefined): AppVariant {
  switch (value) {
    case "development":
    case "preview":
    case "production":
      return value;
    default:
      return "production";
  }
}
