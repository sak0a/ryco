import type { SourceControlCommentAuthorRole } from "@ryco/contracts";
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
