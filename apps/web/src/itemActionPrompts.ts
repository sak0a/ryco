import type { ItemActionKind } from "./components/projectExplorer/itemActions";

const REUSED_CHECKOUT_SUFFIX =
  "\n\nThe workspace reuses an existing checkout: run `git status` first and take any uncommitted work into account before making changes.";

/**
 * Preset prompts for item action threads. They stay short and lean on the
 * attached PR/issue/work-item context rather than duplicating it; the user
 * can edit before sending.
 */
export function buildItemActionPrompt(input: {
  readonly kind: ItemActionKind;
  /** PR base branch, when known. */
  readonly baseBranch?: string;
  /** Failing check/workflow names for `pr-checks`. */
  readonly failingChecks?: ReadonlyArray<string>;
  /** True when the resolved workspace reuses an existing checkout. */
  readonly reusesExistingCheckout: boolean;
}): string {
  const base = input.baseBranch ?? "the base branch";
  let prompt: string;
  switch (input.kind) {
    case "pr-conflicts":
      prompt = `The attached pull request has merge conflicts with ${base}. Fetch the latest ${base} and merge it into this branch, resolve every conflict while preserving the intent of both sides, run the project's checks, and push the result.`;
      break;
    case "pr-review":
      prompt = `The attached pull request has requested changes. Read the review comments in the attached context, address each one — with a code change or a short reasoned reply where a change isn't warranted — run the project's checks, push, and summarize what changed per comment.`;
      break;
    case "pr-checks": {
      const names =
        input.failingChecks && input.failingChecks.length > 0
          ? ` (${input.failingChecks.join(", ")})`
          : "";
      prompt = `CI is failing on the attached pull request${names}. Inspect the failing runs and their logs, reproduce the failures locally where possible, fix them, run the project's checks, and push.`;
      break;
    }
    case "implement-issue":
      prompt = `Implement the attached issue. Follow its description and acceptance criteria; keep the change focused on what the issue asks for and call out anything that would expand scope. Run the project's checks before finishing.`;
      break;
    case "implement-work-item":
      prompt = `Implement the attached work item. Follow its description and acceptance criteria; keep the change focused on what the ticket asks for and call out anything that would expand scope. Run the project's checks before finishing.`;
      break;
  }
  return input.reusesExistingCheckout ? prompt + REUSED_CHECKOUT_SUFFIX : prompt;
}
