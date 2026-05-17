import { Effect, Option } from "effect";
import { CommandId, type WorktreeId } from "@ryco/contracts";

import { OrchestrationEngineService } from "../orchestration/Services/OrchestrationEngine.ts";
import { ProjectionWorktreeRepository } from "../persistence/Services/ProjectionWorktrees.ts";
import { SourceControlProviderRegistry } from "./SourceControlProviderRegistry.ts";

export interface RefreshWorktreeSourceControlStateInput {
  readonly worktreeId: WorktreeId;
}

export const refreshWorktreeSourceControlState = Effect.fn("refreshWorktreeSourceControlState")(
  function* (input: RefreshWorktreeSourceControlStateInput) {
    const repo = yield* ProjectionWorktreeRepository;
    const row = yield* repo.getById({ worktreeId: input.worktreeId });
    if (Option.isNone(row)) return;
    const existing = row.value;
    if (existing.prNumber === null && existing.issueNumber === null) return;

    const registry = yield* SourceControlProviderRegistry;
    const cwd = existing.worktreePath ?? process.cwd();
    const provider = yield* registry.resolve({ cwd });

    let nextPrState = existing.prState;
    let nextPrIsDraft = existing.prIsDraft;
    if (existing.prNumber !== null) {
      const pr = yield* provider
        .getPullRequestState({ number: existing.prNumber, cwd })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to refresh PR state", { cause }).pipe(Effect.as(null)),
          ),
        );
      if (pr !== null) {
        nextPrState = pr.state;
        nextPrIsDraft = pr.isDraft;
      }
    }

    let nextIssueState = existing.issueState;
    if (existing.issueNumber !== null) {
      const issue = yield* provider
        .getIssueState({ number: existing.issueNumber, cwd })
        .pipe(
          Effect.catch((cause) =>
            Effect.logWarning("Failed to refresh issue state", { cause }).pipe(Effect.as(null)),
          ),
        );
      if (issue !== null) {
        nextIssueState = issue.state;
      }
    }

    const changed =
      nextPrState !== existing.prState ||
      nextPrIsDraft !== existing.prIsDraft ||
      nextIssueState !== existing.issueState;
    if (!changed) return;

    const engine = yield* OrchestrationEngineService;
    yield* engine.dispatch({
      type: "worktree.source-control-state.update",
      commandId: CommandId.make(`server:refresh-sc-state:${crypto.randomUUID()}`),
      worktreeId: input.worktreeId,
      prState: nextPrState,
      prIsDraft: nextPrIsDraft,
      issueState: nextIssueState,
      updatedAt: new Date().toISOString(),
    });
  },
);
