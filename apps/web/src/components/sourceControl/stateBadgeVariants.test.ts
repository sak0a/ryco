import { describe, expect, it } from "vitest";
import {
  CheckCircle2Icon,
  CircleDotIcon,
  GitMergeIcon,
  GitPullRequestDraftIcon,
  GitPullRequestIcon,
  XCircleIcon,
} from "lucide-react";
import { resolveStateBadgeVariant } from "./stateBadgeVariants";

describe("resolveStateBadgeVariant", () => {
  it("returns issue-open for an open issue", () => {
    const variant = resolveStateBadgeVariant({ kind: "issue", state: "open" });
    expect(variant.kind).toBe("issue-open");
    expect(variant.Icon).toBe(CircleDotIcon);
    expect(variant.label).toBe("Open");
    expect(variant.tone).toBe("emerald");
  });

  it("returns issue-closed for a closed issue", () => {
    const variant = resolveStateBadgeVariant({ kind: "issue", state: "closed" });
    expect(variant.kind).toBe("issue-closed");
    expect(variant.Icon).toBe(CheckCircle2Icon);
    expect(variant.tone).toBe("violet");
  });

  it("returns pr-draft when isDraft is true regardless of state", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: true });
    expect(variant.kind).toBe("pr-draft");
    expect(variant.Icon).toBe(GitPullRequestDraftIcon);
    expect(variant.tone).toBe("zinc");
  });

  it("returns pr-open for a non-draft open PR", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "open", isDraft: false });
    expect(variant.kind).toBe("pr-open");
    expect(variant.Icon).toBe(GitPullRequestIcon);
    expect(variant.tone).toBe("emerald");
  });

  it("returns pr-merged for a merged PR", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "merged" });
    expect(variant.kind).toBe("pr-merged");
    expect(variant.Icon).toBe(GitMergeIcon);
    expect(variant.tone).toBe("violet");
  });

  it("returns pr-closed for a closed unmerged PR", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: "closed" });
    expect(variant.kind).toBe("pr-closed");
    expect(variant.Icon).toBe(XCircleIcon);
    expect(variant.tone).toBe("rose");
  });

  it("returns unknown-issue fallback for issue with null state", () => {
    const variant = resolveStateBadgeVariant({ kind: "issue", state: null });
    expect(variant.kind).toBe("issue-unknown");
    expect(variant.Icon).toBe(CircleDotIcon);
    expect(variant.tone).toBe("emerald");
    expect(variant.label).toBeNull();
  });

  it("returns unknown-pr fallback for pr with null state", () => {
    const variant = resolveStateBadgeVariant({ kind: "pr", state: null });
    expect(variant.kind).toBe("pr-unknown");
    expect(variant.Icon).toBe(GitPullRequestIcon);
    expect(variant.tone).toBe("blue");
    expect(variant.label).toBeNull();
  });
});
