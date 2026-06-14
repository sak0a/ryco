import { createHash } from "node:crypto";

export const randomShortId = (length = 8) =>
  Array.from({ length }, () =>
    "abcdefghijklmnopqrstuvwxyz0123456789".charAt(Math.floor(Math.random() * 36)),
  ).join("");

const deterministicShortId = (input: string, length = 6): string =>
  createHash("sha256").update(input).digest("hex").slice(0, length);

export const buildIssueBranchNameFallback = (number: number): string =>
  `issue/${number}-${deterministicShortId(String(number), 6)}`;

const branchSlug = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "")
    .slice(0, 48);

export const buildWorkItemBranchNameFallback = (input: { key: string; title?: string }): string => {
  const key = input.key.trim().toUpperCase();
  const titleSlug = branchSlug(input.title ?? "");
  return titleSlug.length > 0 ? `${key}-${titleSlug}` : `${key}-${deterministicShortId(key, 6)}`;
};

export const ensureWorkItemBranchNameIncludesKey = (input: {
  readonly branch: string;
  readonly fallback: string;
  readonly key: string;
}): string => {
  const branch = input.branch.trim();
  if (!branch) return input.fallback;
  const normalizedBranch = branch.toLowerCase();
  const normalizedKey = input.key.toLowerCase();
  return normalizedBranch.includes(normalizedKey) ? branch : `${input.key}-${branch}`;
};

export const buildIssueBranchNameMessage = (input: {
  readonly number: number;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}): string => {
  const lines = [`Create a branch name for issue #${input.number}.`];
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title) {
    lines.push("", `Title: ${title}`);
  }
  if (body) {
    lines.push("", `Body: ${body}`);
  }
  return lines.join("\n");
};

export const buildWorkItemBranchNameMessage = (input: {
  readonly key: string;
  readonly title?: string | undefined;
  readonly body?: string | undefined;
}): string => {
  const lines = [`Create a branch name for Jira work item ${input.key}.`];
  const title = input.title?.trim();
  const body = input.body?.trim();
  if (title) {
    lines.push("", `Title: ${title}`);
  }
  if (body) {
    lines.push("", `Body: ${body}`);
  }
  lines.push("", `The branch name should include the Jira key ${input.key}.`);
  return lines.join("\n");
};
