import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import {
  appendQuoteToCommentDraft,
  authorAssociationLabel,
  avatarUrlForAuthor,
  buildCommentQuoteMarkdown,
  commentRoleBadges,
  commentToneForAuthorRole,
  deriveOriginalPostAuthorRole,
  hasSubmittableCommentDraft,
  hashAuthorToHue,
  normalizeCommentDraftForSubmit,
} from "./CommentThread.logic";

describe("avatarUrlForAuthor", () => {
  it("returns null for unknown author", () => {
    expect(avatarUrlForAuthor("unknown")).toBeNull();
  });

  it("returns null for empty author", () => {
    expect(avatarUrlForAuthor("")).toBeNull();
  });

  it("returns the GitHub avatar redirect URL for a normal login", () => {
    expect(avatarUrlForAuthor("octocat")).toBe("https://github.com/octocat.png?size=80");
  });

  it("URL-encodes special characters in the login", () => {
    expect(avatarUrlForAuthor("foo bar")).toBe("https://github.com/foo%20bar.png?size=80");
  });
});

describe("authorAssociationLabel", () => {
  it("returns null when association is undefined", () => {
    expect(authorAssociationLabel(undefined)).toBeNull();
  });

  it("returns null for NONE", () => {
    expect(authorAssociationLabel("NONE")).toBeNull();
  });

  it("returns null for empty string", () => {
    expect(authorAssociationLabel("")).toBeNull();
  });

  it("returns null for unknown values", () => {
    expect(authorAssociationLabel("WHATEVER")).toBeNull();
  });

  it("returns 'Owner' for OWNER", () => {
    expect(authorAssociationLabel("OWNER")).toBe("Owner");
  });

  it("returns 'Member' for MEMBER", () => {
    expect(authorAssociationLabel("MEMBER")).toBe("Member");
  });

  it("returns 'Maintainer' for GitHub member aliases", () => {
    expect(authorAssociationLabel("MEMBER_OF_REPOSITORY")).toBe("Maintainer");
    expect(authorAssociationLabel("MEMBER_OF_ORG")).toBe("Maintainer");
  });

  it("returns 'Collaborator' for COLLABORATOR", () => {
    expect(authorAssociationLabel("COLLABORATOR")).toBe("Collaborator");
  });

  it("returns 'Contributor' for CONTRIBUTOR", () => {
    expect(authorAssociationLabel("CONTRIBUTOR")).toBe("Contributor");
  });

  it("returns 'Author' for FIRST_TIME_CONTRIBUTOR and FIRST_TIMER", () => {
    expect(authorAssociationLabel("FIRST_TIME_CONTRIBUTOR")).toBe("First-time contributor");
    expect(authorAssociationLabel("FIRST_TIMER")).toBe("First-time contributor");
  });
});

describe("hashAuthorToHue", () => {
  it("returns a deterministic hue in 0-359 for any author", () => {
    const a = hashAuthorToHue("alice");
    const b = hashAuthorToHue("alice");
    expect(a).toBe(b);
    expect(a).toBeGreaterThanOrEqual(0);
    expect(a).toBeLessThan(360);
  });

  it("returns different hues for different authors", () => {
    const a = hashAuthorToHue("alice");
    const b = hashAuthorToHue("bob");
    expect(a).not.toBe(b);
  });

  it("handles empty author with a stable fallback", () => {
    expect(hashAuthorToHue("")).toBeGreaterThanOrEqual(0);
    expect(hashAuthorToHue("")).toBeLessThan(360);
  });
});

describe("comment roles", () => {
  it("uses author tone and badge for original author comments", () => {
    const role = {
      primary: "author" as const,
      isOriginalAuthor: true,
      isRepositoryOwner: false,
      isRepositoryMaintainer: false,
    };
    expect(commentToneForAuthorRole(role)).toBe("author");
    expect(commentRoleBadges({ role })).toEqual([{ label: "Author", tone: "author" }]);
  });

  it("uses owner or maintainer tone for privileged repository participants", () => {
    const ownerRole = {
      primary: "owner" as const,
      isOriginalAuthor: false,
      isRepositoryOwner: true,
      isRepositoryMaintainer: false,
    };
    const maintainerRole = {
      primary: "maintainer" as const,
      isOriginalAuthor: false,
      isRepositoryOwner: false,
      isRepositoryMaintainer: true,
    };
    expect(commentToneForAuthorRole(ownerRole)).toBe("owner");
    expect(commentRoleBadges({ role: ownerRole })).toEqual([{ label: "Owner", tone: "owner" }]);
    expect(commentToneForAuthorRole(maintainerRole)).toBe("maintainer");
    expect(commentRoleBadges({ role: maintainerRole })).toEqual([
      { label: "Maintainer", tone: "maintainer" },
    ]);
  });

  it("keeps author tone but exposes owner badge for combined author-owner comments", () => {
    const role = {
      primary: "author" as const,
      isOriginalAuthor: true,
      isRepositoryOwner: true,
      isRepositoryMaintainer: false,
    };
    expect(commentToneForAuthorRole(role)).toBe("author");
    expect(commentRoleBadges({ role })).toEqual([
      { label: "Author", tone: "author" },
      { label: "Owner", tone: "owner" },
    ]);
  });

  it("keeps ordinary participants visually neutral", () => {
    const role = {
      primary: "participant" as const,
      isOriginalAuthor: false,
      isRepositoryOwner: false,
      isRepositoryMaintainer: false,
    };
    expect(commentToneForAuthorRole(role)).toBe("participant");
    expect(commentRoleBadges({ role, association: "NONE" })).toEqual([]);
  });

  it("uses authorAssociation as a tone fallback when structured role is absent", () => {
    expect(commentToneForAuthorRole(undefined, false, "OWNER")).toBe("owner");
    expect(commentToneForAuthorRole(undefined, false, "MEMBER")).toBe("maintainer");
    expect(commentToneForAuthorRole(undefined, false, "COLLABORATOR")).toBe("maintainer");
    expect(commentToneForAuthorRole(undefined, false, "MEMBER_OF_REPOSITORY")).toBe("maintainer");
    expect(commentToneForAuthorRole(undefined, false, "MEMBER_OF_ORG")).toBe("maintainer");
    expect(commentToneForAuthorRole(undefined, false, "NONE")).toBe("participant");
  });
});

describe("deriveOriginalPostAuthorRole", () => {
  it("derives a combined author-owner role for repository-owner authors", () => {
    expect(
      deriveOriginalPostAuthorRole({
        url: "https://github.com/alice/repo/issues/42",
        author: "alice",
      }),
    ).toEqual({
      author: "alice",
      role: {
        primary: "author",
        isOriginalAuthor: true,
        isRepositoryOwner: true,
        isRepositoryMaintainer: false,
      },
    });
  });

  it("uses a stable unknown fallback when the original author is missing", () => {
    expect(
      deriveOriginalPostAuthorRole({
        url: "https://github.com/alice/repo/pull/9",
        author: null,
      }),
    ).toEqual({
      author: "unknown",
      role: {
        primary: "participant",
        isOriginalAuthor: false,
        isRepositoryOwner: false,
        isRepositoryMaintainer: false,
      },
    });
  });
});

describe("comment quote markdown", () => {
  const createdAt = DateTime.fromDateUnsafe(new Date("2026-03-14T10:05:30.000Z"));

  it("builds a full-body blockquote with author, context, and UTC timestamp", () => {
    expect(
      buildCommentQuoteMarkdown({
        author: "octocat",
        contextLabel: "PR conversation",
        createdAt,
        body: "Looks good.\n\nOne follow-up.",
      }),
    ).toBe(
      [
        "> @octocat wrote in PR conversation on 2026-03-14 10:05 UTC:",
        ">",
        "> Looks good.",
        ">",
        "> One follow-up.",
      ].join("\n"),
    );
  });

  it("normalizes CRLF bodies before quoting", () => {
    expect(
      buildCommentQuoteMarkdown({
        author: "alice",
        createdAt,
        body: "line one\r\nline two\r",
      }),
    ).toContain("> line one\n> line two");
  });

  it("appends quotes without replacing an existing draft", () => {
    const quote = buildCommentQuoteMarkdown({
      author: "alice",
      contextLabel: "issue comment",
      createdAt,
      body: "Please add docs.",
    });

    expect(appendQuoteToCommentDraft("Existing draft", quote)).toBe(
      `Existing draft\n\n${quote}\n\n`,
    );
  });

  it("keeps a single blank line before appended quotes when the draft already ends with newline", () => {
    const quote = "> quoted";
    expect(appendQuoteToCommentDraft("Existing draft\n", quote)).toBe(
      "Existing draft\n\n> quoted\n\n",
    );
    expect(appendQuoteToCommentDraft("Existing draft\n\n", quote)).toBe(
      "Existing draft\n\n> quoted\n\n",
    );
  });
});

describe("comment draft submission", () => {
  it("preserves leading markdown whitespace while trimming trailing blank space", () => {
    expect(normalizeCommentDraftForSubmit("    code block\n")).toBe("    code block");
  });

  it("uses trimmed content only to decide whether a draft is submittable", () => {
    expect(hasSubmittableCommentDraft("   ")).toBe(false);
    expect(hasSubmittableCommentDraft("  **ship it**  ")).toBe(true);
  });
});
