// Mobile-local shape for git-diff-preview review sections.
//
// The upstream reference app ships these as a canonical contracts `review.ts`
// module (the git working-tree / branch-range diff-preview RPC).
// Ryco's `@ryco/contracts` deliberately omits that module — git-diff previews
// are a B2 non-goal ("MVP shows diffs, not the full git action set"), and the
// Ryco node emits no such payload. The review model still carries the
// `gitSections` parameter for structural parity with upstream, but MVP callers
// always pass an empty list, so this type is a local presentation shape rather
// than a wire contract. If/when git-diff previews land, this is replaced by the
// real `@ryco/contracts` export.
export type ReviewDiffPreviewSourceKind = "working-tree" | "branch-range";

export interface ReviewDiffPreviewSource {
  readonly id: string;
  readonly kind: ReviewDiffPreviewSourceKind;
  readonly title: string;
  readonly baseRef: string | null;
  readonly headRef: string | null;
  readonly diff: string;
  readonly diffHash: string;
  readonly truncated: boolean;
}
