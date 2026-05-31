import type { SourceControlCommentAuthorRole } from "@ryco/contracts";
import { DateTime } from "effect";
import {
  classifySourceControlCommentAuthorRole,
  parseGitHubRepositoryOwnerFromUrl,
} from "@ryco/shared/sourceControl";

const UNKNOWN_AUTHOR_PLACEHOLDER = "unknown";

export function avatarUrlForAuthor(author: string): string | null {
  const trimmed = author.trim();
  if (trimmed.length === 0) return null;
  if (trimmed === UNKNOWN_AUTHOR_PLACEHOLDER) return null;
  return `https://github.com/${encodeURIComponent(trimmed)}.png?size=80`;
}

const ASSOCIATION_LABELS: Record<string, string> = {
  OWNER: "Owner",
  MEMBER: "Member",
  COLLABORATOR: "Collaborator",
  MEMBER_OF_REPOSITORY: "Maintainer",
  MEMBER_OF_ORG: "Maintainer",
  CONTRIBUTOR: "Contributor",
  FIRST_TIME_CONTRIBUTOR: "First-time contributor",
  FIRST_TIMER: "First-time contributor",
};

export function authorAssociationLabel(association: string | undefined): string | null {
  if (association === undefined) return null;
  if (association.length === 0) return null;
  return ASSOCIATION_LABELS[association] ?? null;
}

export type CommentRoleTone = "author" | "owner" | "maintainer" | "participant";
export type CommentRoleBadgeTone = "author" | "owner" | "maintainer" | "default";

export interface CommentRoleBadge {
  readonly label: string;
  readonly tone: CommentRoleBadgeTone;
}

export interface OriginalPostAuthorRolePresentation {
  readonly author: string;
  readonly role: SourceControlCommentAuthorRole;
}

function normalizeAssociation(association: string | undefined): string | null {
  const trimmed = association?.trim() ?? "";
  return trimmed.length > 0 ? trimmed.toUpperCase() : null;
}

function associationTone(association: string | null): CommentRoleTone | null {
  if (association === "OWNER") return "owner";
  if (
    association === "MEMBER" ||
    association === "COLLABORATOR" ||
    association === "MEMBER_OF_REPOSITORY" ||
    association === "MEMBER_OF_ORG"
  ) {
    return "maintainer";
  }
  return null;
}

export function commentToneForAuthorRole(
  role: SourceControlCommentAuthorRole | undefined,
  isOriginalPost = false,
  association?: string | undefined,
): CommentRoleTone {
  if (isOriginalPost || role?.primary === "author" || role?.isOriginalAuthor === true) {
    return "author";
  }
  if (role?.primary === "owner" || role?.isRepositoryOwner === true) {
    return "owner";
  }
  if (role?.primary === "maintainer" || role?.isRepositoryMaintainer === true) {
    return "maintainer";
  }
  const fallbackTone = associationTone(normalizeAssociation(association));
  if (fallbackTone !== null) return fallbackTone;
  return "participant";
}

export function commentRoleBadges(input: {
  readonly role?: SourceControlCommentAuthorRole | undefined;
  readonly association?: string | undefined;
  readonly isOriginalPost?: boolean | undefined;
}): ReadonlyArray<CommentRoleBadge> {
  const badges: CommentRoleBadge[] = [];
  const association = normalizeAssociation(input.association);

  // Author styling takes visual precedence; owner/maintainer status remains visible as badges.
  if (input.isOriginalPost || input.role?.isOriginalAuthor === true) {
    badges.push({ label: "Author", tone: "author" });
  }
  if (input.role?.isRepositoryOwner === true) {
    badges.push({ label: "Owner", tone: "owner" });
  }
  if (input.role?.isRepositoryMaintainer === true) {
    badges.push({ label: "Maintainer", tone: "maintainer" });
  }

  if (badges.length > 0) {
    if (
      association !== null &&
      association !== "OWNER" &&
      association !== "MEMBER" &&
      association !== "COLLABORATOR" &&
      association !== "NONE"
    ) {
      const label = authorAssociationLabel(association);
      if (label !== null) badges.push({ label, tone: "default" });
    }
    return badges;
  }

  const label = authorAssociationLabel(association ?? undefined);
  if (label === null) return [];
  if (association === "OWNER") return [{ label, tone: "owner" }];
  if (associationTone(association) === "maintainer") {
    return [{ label: "Maintainer", tone: "maintainer" }];
  }
  return [{ label, tone: "default" }];
}

export function deriveOriginalPostAuthorRole(input: {
  readonly url: string;
  readonly author?: string | null | undefined;
}): OriginalPostAuthorRolePresentation {
  const author = input.author ?? "unknown";
  return {
    author,
    role: classifySourceControlCommentAuthorRole({
      commentAuthor: author,
      itemAuthor: input.author,
      repositoryOwner: parseGitHubRepositoryOwnerFromUrl(input.url),
    }),
  };
}

export function hashAuthorToHue(author: string): number {
  const seed = author.length === 0 ? "@anon@" : author;
  let hash = 0;
  for (let i = 0; i < seed.length; i += 1) {
    hash = (hash * 31 + seed.charCodeAt(i)) >>> 0;
  }
  return hash % 360;
}

export interface CommentQuoteMarkdownInput {
  readonly author: string;
  readonly body: string;
  readonly createdAt: DateTime.Utc;
  readonly contextLabel?: string | undefined;
}

function quoteAuthor(author: string): string {
  const trimmed = author.trim();
  if (trimmed.length === 0 || trimmed === UNKNOWN_AUTHOR_PLACEHOLDER) return "unknown author";
  return `@${trimmed}`;
}

function quoteTimestamp(createdAt: DateTime.Utc): string {
  const date = DateTime.toDate(createdAt);
  return `${date.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}

function quoteBodyLines(body: string): ReadonlyArray<string> {
  const normalized = body.replace(/\r\n?/gu, "\n").replace(/\n+$/u, "");
  if (normalized.trim().length === 0) return ["> _No comment body._"];
  return normalized.split("\n").map((line) => (line.length > 0 ? `> ${line}` : ">"));
}

export function buildCommentQuoteMarkdown(input: CommentQuoteMarkdownInput): string {
  const contextLabel = input.contextLabel?.trim();
  const context = contextLabel ? ` in ${contextLabel}` : "";
  // First-pass quote replies quote the full comment body; selected-text quoting needs
  // selection-to-source mapping from the rendered Markdown comments.
  return [
    `> ${quoteAuthor(input.author)} wrote${context} on ${quoteTimestamp(input.createdAt)}:`,
    ">",
    ...quoteBodyLines(input.body),
  ].join("\n");
}

export function appendQuoteToCommentDraft(draft: string, quoteMarkdown: string): string {
  const quote = quoteMarkdown.trimEnd();
  if (quote.length === 0) return draft;
  const separator =
    draft.length === 0 ? "" : draft.endsWith("\n\n") ? "" : draft.endsWith("\n") ? "\n" : "\n\n";
  return `${draft}${separator}${quote}\n\n`;
}

export function normalizeCommentDraftForSubmit(draft: string): string {
  return draft.trimEnd();
}

export function hasSubmittableCommentDraft(draft: string): boolean {
  return draft.trim().length > 0;
}
