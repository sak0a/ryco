/**
 * Classification for source-control fetch failures shown in the overview.
 *
 * The provider CLIs surface long, developer-facing errors — e.g. a timeout
 * carries the full `gh pr view 159 --json number,title,…` command. That is
 * useless (and alarming) to a user, so we map errors to short copy and a
 * transient/terminal kind, and keep the raw text only for logging.
 */

/** How the overview should treat a source-control fetch failure. */
export type OverviewErrorKind = "transient" | "terminal";

export interface OverviewErrorInfo {
  kind: OverviewErrorKind;
  /** Short, user-facing copy. Never contains the raw command or stack trace. */
  message: string;
  /** Original error text, kept for logging/debugging only — never displayed. */
  raw: string;
}

function rawErrorText(error: unknown): string {
  if (error == null) return "";
  if (typeof error === "string") return error;
  if (error instanceof Error) return error.message;
  if (
    typeof error === "object" &&
    "message" in error &&
    typeof (error as { message: unknown }).message === "string"
  ) {
    return (error as { message: string }).message;
  }
  return String(error);
}

interface ErrorRule {
  kind: OverviewErrorKind;
  message: string;
  patterns: ReadonlyArray<string>;
}

// First rule whose pattern is found (case-insensitive) wins, so the more
// specific / terminal rules come first.
const ERROR_RULES: ReadonlyArray<ErrorRule> = [
  {
    kind: "terminal",
    message: "Sign in to your source control provider to load this pull request.",
    patterns: [
      "gh auth",
      "not logged in",
      "authentication",
      "unauthorized",
      "http 401",
      "401",
      "bad credentials",
    ],
  },
  {
    kind: "terminal",
    message: "This pull request could not be found.",
    patterns: ["could not resolve to a", "not found", "404", "no pull requests found"],
  },
  {
    kind: "transient",
    message: "The source control provider is rate limiting requests. Try again shortly.",
    patterns: ["rate limit"],
  },
  {
    kind: "transient",
    message: "Loading pull request details timed out. Try refreshing.",
    patterns: ["timed out", "timeout", "etimedout", "vcsprocesstimeout"],
  },
  {
    kind: "transient",
    message: "Couldn't reach the source control provider. Try refreshing.",
    patterns: [
      "econnreset",
      "enotfound",
      "eai_again",
      "socket hang up",
      "network",
      "fetch failed",
      "econnrefused",
      "connection refused",
    ],
  },
];

/**
 * Classify a source-control fetch error into short user copy + a
 * transient/terminal kind, or `null` when there is no error. Unknown errors are
 * treated as transient: surfaced once, then kept quiet with a retry affordance,
 * rather than pinned as an unexplained banner.
 */
export function classifyOverviewError(error: unknown): OverviewErrorInfo | null {
  const raw = rawErrorText(error).trim();
  if (raw.length === 0) return null;

  const haystack = raw.toLowerCase();
  for (const rule of ERROR_RULES) {
    if (rule.patterns.some((pattern) => haystack.includes(pattern))) {
      return { kind: rule.kind, message: rule.message, raw };
    }
  }
  return {
    kind: "transient",
    message: "Couldn't load pull request details. Try refreshing.",
    raw,
  };
}
