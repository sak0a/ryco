import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { DateTime } from "effect";
import type { SourceControlCommentAuthorRole, SourceControlIssueComment } from "@ryco/contracts";
import { CommentItem, CommentThread } from "./CommentThread";

function comment(
  partial: Partial<SourceControlIssueComment> & { author: string },
): SourceControlIssueComment {
  return {
    body: partial.body ?? "Hello world",
    createdAt: partial.createdAt ?? DateTime.fromDateUnsafe(new Date("2026-03-14T10:00:00Z")),
    author: partial.author,
    ...(partial.authorAssociation !== undefined
      ? { authorAssociation: partial.authorAssociation }
      : {}),
    ...(partial.authorRole !== undefined ? { authorRole: partial.authorRole } : {}),
  };
}

function role(partial: Partial<SourceControlCommentAuthorRole>): SourceControlCommentAuthorRole {
  return {
    primary: partial.primary ?? "participant",
    isOriginalAuthor: partial.isOriginalAuthor ?? false,
    isRepositoryOwner: partial.isRepositoryOwner ?? false,
    isRepositoryMaintainer: partial.isRepositoryMaintainer ?? false,
  };
}

describe("CommentThread", () => {
  it("renders an avatar image pointing at the author's GitHub profile", () => {
    const markup = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "octocat" })]} />,
    );
    expect(markup).toContain('src="https://github.com/octocat.png?size=80"');
  });

  it("falls back to a colored initial bubble when the author is unknown", () => {
    const markup = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "unknown" })]} />,
    );
    expect(markup).not.toContain("github.com/unknown.png");
    expect(markup).toContain("hsl(");
    expect(markup).toContain(">U<");
  });

  it("renders an author-association badge when present and recognized", () => {
    const markup = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "alice", authorAssociation: "OWNER" })]} />,
    );
    expect(markup).toContain("Owner");
  });

  it("hides the badge for NONE", () => {
    const markup = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "alice", authorAssociation: "NONE" })]} />,
    );
    expect(markup).not.toMatch(/>None</);
  });

  it("hides the badge for unknown association values", () => {
    const markup = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "alice", authorAssociation: "MANNEQUIN" })]} />,
    );
    expect(markup).not.toMatch(/>Mannequin</);
  });

  it("renders original author comments with author styling", () => {
    const markup = renderToStaticMarkup(
      <CommentThread
        comments={[
          comment({
            author: "alice",
            authorRole: role({ primary: "author", isOriginalAuthor: true }),
          }),
        ]}
      />,
    );
    expect(markup).toContain(">Author<");
    expect(markup).toContain("border-primary/30");
  });

  it("renders owner and maintainer comments with distinct badges", () => {
    const markup = renderToStaticMarkup(
      <CommentThread
        comments={[
          comment({
            author: "owner",
            authorRole: role({ primary: "owner", isRepositoryOwner: true }),
          }),
          comment({
            author: "maintainer",
            authorRole: role({ primary: "maintainer", isRepositoryMaintainer: true }),
          }),
        ]}
      />,
    );
    expect(markup).toContain(">Owner<");
    expect(markup).toContain("border-amber-500/28");
    expect(markup).toContain(">Maintainer<");
    expect(markup).toContain("border-sky-500/28");
  });

  it("renders combined author-owner comments as author while exposing owner status", () => {
    const markup = renderToStaticMarkup(
      <CommentThread
        comments={[
          comment({
            author: "alice",
            authorRole: role({
              primary: "author",
              isOriginalAuthor: true,
              isRepositoryOwner: true,
            }),
          }),
        ]}
      />,
    );
    expect(markup).toContain(">Author<");
    expect(markup).toContain(">Owner<");
    expect(markup).toContain("border-primary/30");
  });

  it("preserves ordinary participant rendering", () => {
    const markup = renderToStaticMarkup(
      <CommentThread
        comments={[
          comment({
            author: "bob",
            authorRole: role({ primary: "participant" }),
          }),
        ]}
      />,
    );
    expect(markup).not.toContain(">Author<");
    expect(markup).not.toContain(">Owner<");
    expect(markup).not.toContain(">Maintainer<");
    expect(markup).toContain("border-border/60");
  });

  it("renders quote actions only when a quote handler is available", () => {
    const withoutQuote = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "alice" })]} />,
    );
    const withQuote = renderToStaticMarkup(
      <CommentThread comments={[comment({ author: "alice" })]} onQuoteComment={() => undefined} />,
    );
    expect(withoutQuote).not.toContain("Quote alice&#x27;s comment");
    expect(withQuote).toContain("Quote alice&#x27;s comment");
  });
});

describe("CommentItem", () => {
  it("renders a quote action for original issue or PR conversation posts", () => {
    const markup = renderToStaticMarkup(
      <CommentItem
        author="octocat"
        body="Original body"
        createdAt={DateTime.fromDateUnsafe(new Date("2026-03-14T10:00:00Z"))}
        isOriginalPost
        onQuote={() => undefined}
      />,
    );
    expect(markup).toContain("Quote octocat&#x27;s comment");
    expect(markup).toContain("Quote reply");
  });
});
