import type { ServerFramework } from "@ryco/contracts";

export interface ArgvHint {
  framework: ServerFramework;
  isLikelyServer: boolean;
}

export interface PackageJsonShape {
  scripts?: Record<string, string>;
}

const DENY_TOKENS = new Set([
  "build",
  "test",
  "tsc",
  "eslint",
  "prettier",
  "playwright",
  "typecheck",
  "lint",
  "fmt",
]);

const SERVER_TRIGGER_TOKENS = new Set(["dev", "serve", "start", "watch"]);

const FRAMEWORK_TOKEN_MAP: ReadonlyArray<readonly [string, ServerFramework]> = [
  ["vite", "vite"],
  ["next", "next"],
  ["nuxt", "nuxt"],
  ["nuxi", "nuxt"],
  ["astro", "astro"],
  ["remix", "remix"],
  ["wrangler", "wrangler"],
  ["storybook", "storybook"],
  ["webpack-dev-server", "webpack"],
];

const PACKAGE_RUNNERS = new Set(["npm", "pnpm", "yarn", "bun"]);

/** Strip path components from a token, returning only the filename portion. */
const basename = (token: string): string => token.split(/[\\/]/).pop() ?? token;

export const hintFromArgv = (
  argv: ReadonlyArray<string>,
  pkg: PackageJsonShape | undefined,
): ArgvHint => {
  const tokens = argv.map((t) => t.toLowerCase());

  // Indirect invocation: <runner> run <script-name>
  // One-level expansion only — passing `undefined` for pkg in the recursive
  // call prevents infinite loops on scripts that reference each other.
  if (
    tokens.length >= 3 &&
    PACKAGE_RUNNERS.has(tokens[0]!) &&
    tokens[1] === "run" &&
    pkg?.scripts?.[tokens[2]!]
  ) {
    const inner = pkg.scripts[tokens[2]!]!.split(/\s+/).filter(Boolean);
    return hintFromArgv(inner, undefined);
  }

  // Shortcut: <runner> dev / serve / start / watch (no explicit "run" keyword)
  // One-level expansion only — passing `undefined` for pkg prevents infinite loops.
  if (
    tokens.length >= 2 &&
    PACKAGE_RUNNERS.has(tokens[0]!) &&
    SERVER_TRIGGER_TOKENS.has(tokens[1]!)
  ) {
    if (pkg?.scripts?.[tokens[1]!]) {
      const inner = pkg.scripts[tokens[1]!]!.split(/\s+/).filter(Boolean);
      return hintFromArgv(inner, undefined);
    }
  }

  // Special-case: vitest --ui (UI mode is a server; vitest run is not)
  if (tokens[0] === "vitest" && tokens.includes("--ui")) {
    return { framework: "vitest-ui", isLikelyServer: true };
  }

  // Framework token match.
  // The first argv token is treated as a file path — strip any directory prefix
  // so that `./node_modules/.bin/vite` matches `vite`, but `snextflix` does NOT
  // match `next`.  Only the first three non-flag tokens (binary + subcommand +
  // subsubcommand) are considered; the framework name must be an exact match
  // (with optional JS extension on the head token).
  const head = tokens[0] ? basename(tokens[0]) : "";
  const positional = tokens.slice(0, 3).filter((t) => !t.startsWith("-"));

  for (const [tok, fw] of FRAMEWORK_TOKEN_MAP) {
    const hasFrameworkToken =
      head === tok ||
      head === `${tok}.js` ||
      head === `${tok}.cjs` ||
      head === `${tok}.mjs` ||
      positional.includes(tok);

    if (hasFrameworkToken) {
      const hasDeny = tokens.some((t) => DENY_TOKENS.has(t));
      if (hasDeny) return { framework: fw, isLikelyServer: false };
      return { framework: fw, isLikelyServer: true };
    }
  }

  // Generic server trigger tokens
  const hasServerTrigger = tokens.some((t) => SERVER_TRIGGER_TOKENS.has(t));
  const hasDeny = tokens.some((t) => DENY_TOKENS.has(t));
  if (hasServerTrigger && !hasDeny) {
    return { framework: "unknown", isLikelyServer: true };
  }

  return { framework: "unknown", isLikelyServer: false };
};
