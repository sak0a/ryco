import { PullRequestId } from "@ryco/contracts";
import { decodePullRequestId } from "@ryco/shared/pullRequestIdentity";
import { Schema } from "effect";

export const PULL_REQUEST_VIEWS = [
  "latest",
  "review",
  "assigned",
  "authored",
  "changes-requested",
  "failing",
  "drafts",
  "merged",
  "closed",
] as const;
export type PullRequestView = (typeof PULL_REQUEST_VIEWS)[number];

export type PullRequestDetailTab = "conversation" | "checks" | "commits" | "files";

export interface PullRequestRouteSearch {
  readonly view: PullRequestView;
  readonly q: string;
  readonly provider?: string | undefined;
  readonly repository?: string | undefined;
  readonly state?: "open" | "closed" | "merged" | undefined;
  readonly check?: "passing" | "failing" | "pending" | "neutral" | "unknown" | undefined;
  readonly author?: string | undefined;
  readonly reviewer?: string | undefined;
  readonly pr?: PullRequestId | undefined;
  readonly tab: PullRequestDetailTab;
  readonly focus: boolean;
  readonly listWidth: number;
}

const views = new Set<string>(PULL_REQUEST_VIEWS);
const states = new Set(["open", "closed", "merged"]);
const checks = new Set(["passing", "failing", "pending", "neutral", "unknown"]);
const tabs = new Set(["conversation", "checks", "commits", "files"]);
const MIN_LIST_WIDTH = 320;
const MAX_LIST_WIDTH = 560;
const DEFAULT_LIST_WIDTH = 410;

function optionalString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed.slice(0, 240) : undefined;
}

export function parsePullRequestRouteSearch(
  search: Record<string, unknown>,
): PullRequestRouteSearch {
  const view = views.has(String(search.view)) ? (search.view as PullRequestView) : "latest";
  const q = optionalString(search.q) ?? "";
  const state = states.has(String(search.state))
    ? (search.state as PullRequestRouteSearch["state"])
    : undefined;
  const check = checks.has(String(search.check))
    ? (search.check as PullRequestRouteSearch["check"])
    : undefined;
  const tab = tabs.has(String(search.tab)) ? (search.tab as PullRequestDetailTab) : "conversation";
  const rawWidth = Number(search.listWidth);
  const listWidth = Number.isFinite(rawWidth)
    ? Math.max(MIN_LIST_WIDTH, Math.min(MAX_LIST_WIDTH, Math.round(rawWidth)))
    : DEFAULT_LIST_WIDTH;
  const rawPr = optionalString(search.pr);
  let pr: PullRequestId | undefined;
  if (rawPr && Schema.is(PullRequestId)(rawPr)) {
    try {
      decodePullRequestId(rawPr);
      pr = rawPr;
    } catch {
      pr = undefined;
    }
  }

  return {
    view,
    q,
    ...(optionalString(search.provider) ? { provider: optionalString(search.provider) } : {}),
    ...(optionalString(search.repository) ? { repository: optionalString(search.repository) } : {}),
    ...(state ? { state } : {}),
    ...(check ? { check } : {}),
    ...(optionalString(search.author) ? { author: optionalString(search.author) } : {}),
    ...(optionalString(search.reviewer) ? { reviewer: optionalString(search.reviewer) } : {}),
    ...(pr ? { pr } : {}),
    tab,
    focus: search.focus === true || search.focus === "true" || search.focus === 1,
    listWidth,
  };
}
