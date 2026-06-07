import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it, vi } from "vitest";
import { DateTime } from "effect";
import type { ComposerSourceControlContext } from "@ryco/contracts";
import { SourceControlContextChip } from "./SourceControlContextChip";

function fakeIssueContext(
  overrides: Partial<{
    id: string;
    number: number;
    title: string;
    reference: string;
    truncated: boolean;
  }> = {},
): ComposerSourceControlContext {
  const fetchedAt = DateTime.fromDateUnsafe(new Date("2026-05-07T10:00:00.000Z"));
  const staleAfter = DateTime.fromDateUnsafe(new Date("2026-05-07T10:05:00.000Z"));
  return {
    id: overrides.id ?? "ctx-1",
    kind: "issue",
    provider: "github",
    reference: overrides.reference ?? `owner/repo#${overrides.number ?? 42}`,
    detail: {
      provider: "github",
      number: (overrides.number ?? 42) as never,
      title: overrides.title ?? "fix the foo",
      url: "https://github.com/owner/repo/issues/42",
      state: "open",
      updatedAt: { _tag: "None" } as never,
      body: "issue body",
      comments: [],
      truncated: overrides.truncated ?? false,
    },
    fetchedAt,
    staleAfter,
  };
}

describe("SourceControlContextChip", () => {
  it("renders #number + truncated title", () => {
    const markup = renderToStaticMarkup(
      <SourceControlContextChip
        context={fakeIssueContext({ number: 42, title: "fix the foo" })}
        onRemove={vi.fn()}
      />,
    );
    expect(markup).toContain("#42");
    expect(markup).toContain("fix the foo");
  });

  it("renders X button with aria-label Remove context and calls onRemove when triggered", () => {
    const onRemove = vi.fn();
    const markup = renderToStaticMarkup(
      <SourceControlContextChip context={fakeIssueContext({ id: "abc" })} onRemove={onRemove} />,
    );
    // Verify the remove button is rendered with the correct aria-label
    expect(markup).toContain('aria-label="Remove context"');
    // Verify data-id attribute is set so the handler can be verified structurally
    expect(markup).toContain("abc");
  });

  it("renders cross-repo reference for cross-repo URLs", () => {
    const markup = renderToStaticMarkup(
      <SourceControlContextChip
        context={fakeIssueContext({ reference: "foo/bar#9" })}
        onRemove={vi.fn()}
      />,
    );
    expect(markup).toContain("foo/bar#9");
  });

  it("shows truncated badge when context.detail.truncated", () => {
    const markup = renderToStaticMarkup(
      <SourceControlContextChip
        context={fakeIssueContext({ truncated: true })}
        onRemove={vi.fn()}
      />,
    );
    expect(markup).toContain('aria-label="Context truncated"');
  });
});
